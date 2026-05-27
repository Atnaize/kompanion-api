import { prisma } from '@shared/utils/index.js';
import type { Prisma } from '@prisma/client';
import { notificationEmitter } from '../inbox/index.js';
import { privacyService } from '../privacy/index.js';
import { FriendsService } from '../friends/friends.service.js';
import { conversationsService } from '../chat/index.js';

export type ClubRole = 'owner' | 'admin' | 'member';
export type ClubMemberStatus = 'active' | 'pending_invite' | 'pending_request';
export type ClubVisibility = 'private' | 'public';

/** Allowed accent values. Keep in sync with the PALETTE on the frontend. */
export const CLUB_ACCENT_COLORS = [
  'default',
  'orange',
  'sky',
  'purple',
  'emerald',
  'amber',
  'pink',
] as const;
export type ClubAccentColor = (typeof CLUB_ACCENT_COLORS)[number];

const userPublicSelect = {
  id: true,
  stravaId: true,
  firstname: true,
  lastname: true,
  profile: true,
  profileMedium: true,
} satisfies Prisma.UserSelect;

type UserPublic = Prisma.UserGetPayload<{ select: typeof userPublicSelect }>;

export interface ClubMemberWithUser {
  id: number;
  userId: number;
  role: ClubRole;
  status: ClubMemberStatus;
  joinedAt: string | null;
  user: UserPublic;
}

export interface ClubSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: ClubVisibility;
  accentColor: ClubAccentColor | null;
  createdById: number;
  createdAt: string;
  memberCount: number;
  myRole: ClubRole | null;
  myStatus: ClubMemberStatus | null;
}

export interface ClubDetail extends ClubSummary {
  members: ClubMemberWithUser[];
  pendingInvites: ClubMemberWithUser[];
}

interface CreateClubInput {
  name: string;
  description?: string;
  visibility?: ClubVisibility;
  invitedUserIds?: number[];
}

interface UpdateClubInput {
  name?: string;
  description?: string | null;
  visibility?: ClubVisibility;
  accentColor?: ClubAccentColor | null;
}

/**
 * Clubs MVP: create / list / detail / invite / accept / decline / leave.
 * Owner-only operations: update club metadata, delete club, kick members.
 * Per-club roles are 'owner' (1 per club), 'admin' (can invite/kick), 'member'.
 *
 * Membership lifecycle is tracked on the join row's `status` field:
 *   - 'pending_invite' — admin sent an invite; only the invitee can accept.
 *   - 'pending_request' — user requested to join a public club; admins approve.
 *   - 'active' — confirmed; `role` decides their permissions.
 */
export class ClubsService {
  private friendsService = new FriendsService();

  /**
   * Create a club. Creator becomes the owner. Optionally invite friends in the
   * same transaction (each invited user must already be a friend; otherwise
   * the whole operation is rejected — mirrors challenge invitation rules).
   */
  async createClub(creatorId: number, input: CreateClubInput): Promise<ClubDetail> {
    const trimmedName = input.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 60) {
      throw new Error('Club name must be 2–60 characters');
    }
    const visibility: ClubVisibility = input.visibility ?? 'private';
    if (visibility !== 'private' && visibility !== 'public') {
      throw new Error('Invalid visibility');
    }

    const invitedUserIds = (input.invitedUserIds ?? []).filter((id) => id !== creatorId);
    if (invitedUserIds.length > 0) {
      await this.friendsService.assertAllFriends(creatorId, invitedUserIds);
    }

    const slug = await this.generateUniqueSlug(trimmedName);
    const now = new Date();

    const club = await prisma.$transaction(async (tx) => {
      const created = await tx.club.create({
        data: {
          slug,
          name: trimmedName,
          description: input.description?.trim() || null,
          visibility,
          createdById: creatorId,
        },
      });

      await tx.clubMember.create({
        data: {
          clubId: created.id,
          userId: creatorId,
          role: 'owner',
          status: 'active',
          joinedAt: now,
        },
      });

      if (invitedUserIds.length > 0) {
        await tx.clubMember.createMany({
          data: invitedUserIds.map((uid) => ({
            clubId: created.id,
            userId: uid,
            role: 'member',
            status: 'pending_invite',
            invitedById: creatorId,
          })),
        });
      }
      return created;
    });

    // Emit invite notifications outside the transaction. Failures don't block
    // creation — the in-DB invite rows are the source of truth.
    if (invitedUserIds.length > 0) {
      void this.dispatchInviteNotifications(creatorId, club.id, club.name, invitedUserIds);
    }

    // Create the club's chat up-front (and post the opening notice) so it's
    // available the moment the club exists. Best-effort: the club + memberships
    // are already committed, so a chat hiccup must not fail creation.
    try {
      await conversationsService.onClubMemberJoined(club.id, creatorId, { asCreator: true });
    } catch (err) {
      console.error('[Clubs] club chat init failed:', err);
    }

    return this.getClubById(club.id, creatorId);
  }

  /**
   * List my clubs — every club I'm an active member or invitee of. Includes
   * the cached member count so the hub can render without a second round-trip.
   */
  async listMyClubs(userId: number): Promise<ClubSummary[]> {
    const memberships = await prisma.clubMember.findMany({
      where: {
        userId,
        status: 'active',
      },
      include: {
        club: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (memberships.length === 0) {
      return [];
    }

    const clubIds = memberships.map((m) => m.clubId);
    const counts = await prisma.clubMember.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, status: 'active' },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.clubId, c._count._all]));

    return memberships.map((m) => ({
      id: m.club.id,
      slug: m.club.slug,
      name: m.club.name,
      description: m.club.description,
      visibility: m.club.visibility as ClubVisibility,
      accentColor: (m.club.accentColor as ClubAccentColor | null) ?? null,
      createdById: m.club.createdById,
      createdAt: m.club.createdAt.toISOString(),
      memberCount: countMap.get(m.clubId) ?? 0,
      myRole: m.role as ClubRole,
      myStatus: m.status as ClubMemberStatus,
    }));
  }

  /**
   * Pending invites the viewer can accept. Surfaces in the hub's "Invites" tab
   * and (later) drives the unread badge.
   */
  async listMyInvites(userId: number): Promise<ClubSummary[]> {
    const memberships = await prisma.clubMember.findMany({
      where: {
        userId,
        status: 'pending_invite',
      },
      include: { club: true },
      orderBy: { createdAt: 'desc' },
    });

    if (memberships.length === 0) {
      return [];
    }

    const clubIds = memberships.map((m) => m.clubId);
    const counts = await prisma.clubMember.groupBy({
      by: ['clubId'],
      where: { clubId: { in: clubIds }, status: 'active' },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.clubId, c._count._all]));

    return memberships.map((m) => ({
      id: m.club.id,
      slug: m.club.slug,
      name: m.club.name,
      description: m.club.description,
      visibility: m.club.visibility as ClubVisibility,
      accentColor: (m.club.accentColor as ClubAccentColor | null) ?? null,
      createdById: m.club.createdById,
      createdAt: m.club.createdAt.toISOString(),
      memberCount: countMap.get(m.clubId) ?? 0,
      myRole: null,
      myStatus: 'pending_invite',
    }));
  }

  /**
   * Detailed view of one club. Only accessible if the viewer is a member
   * (active or pending) OR the club is public. Returns active members + (if
   * the viewer is admin/owner) pending invites.
   */
  async getClubById(clubId: string, viewerId: number): Promise<ClubDetail> {
    const club = await prisma.club.findUnique({ where: { id: clubId } });
    if (!club) {
      throw new Error('Club not found');
    }

    const myMembership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });

    const isPublic = club.visibility === 'public';
    if (!myMembership && !isPublic) {
      throw new Error('FORBIDDEN: not a member');
    }

    const myRole = myMembership ? (myMembership.role as ClubRole) : null;
    const myStatus = myMembership ? (myMembership.status as ClubMemberStatus) : null;
    const canManage = myRole === 'owner' || myRole === 'admin';

    const memberRows = await prisma.clubMember.findMany({
      where: { clubId, status: 'active' },
      include: { user: { select: userPublicSelect } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });

    const pendingRows = canManage
      ? await prisma.clubMember.findMany({
          where: { clubId, status: 'pending_invite' },
          include: { user: { select: userPublicSelect } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    return {
      id: club.id,
      slug: club.slug,
      name: club.name,
      description: club.description,
      visibility: club.visibility as ClubVisibility,
      accentColor: (club.accentColor as ClubAccentColor | null) ?? null,
      createdById: club.createdById,
      createdAt: club.createdAt.toISOString(),
      memberCount: memberRows.length,
      myRole,
      myStatus,
      members: memberRows.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role as ClubRole,
        status: m.status as ClubMemberStatus,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        user: m.user,
      })),
      pendingInvites: pendingRows.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role as ClubRole,
        status: m.status as ClubMemberStatus,
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
        user: m.user,
      })),
    };
  }

  /**
   * Update club metadata. Owner or admin only.
   */
  async updateClub(clubId: string, viewerId: number, input: UpdateClubInput): Promise<ClubDetail> {
    await this.assertManage(clubId, viewerId);

    const data: Prisma.ClubUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 60) {
        throw new Error('Club name must be 2–60 characters');
      }
      data.name = name;
    }
    if (input.description !== undefined) {
      data.description = input.description?.trim() || null;
    }
    if (input.visibility !== undefined) {
      if (input.visibility !== 'private' && input.visibility !== 'public') {
        throw new Error('Invalid visibility');
      }
      data.visibility = input.visibility;
    }
    if (input.accentColor !== undefined) {
      if (input.accentColor !== null && !CLUB_ACCENT_COLORS.includes(input.accentColor)) {
        throw new Error('Invalid accent color');
      }
      // Normalise the placeholder 'default' back to null so the column stays
      // tidy and the rendering code only needs one fallback branch.
      data.accentColor = input.accentColor === 'default' ? null : input.accentColor;
    }

    await prisma.club.update({ where: { id: clubId }, data });
    return this.getClubById(clubId, viewerId);
  }

  /**
   * Delete the club entirely. Owner only. Cascade deletes all memberships.
   */
  async deleteClub(clubId: string, viewerId: number): Promise<void> {
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
      select: { role: true },
    });
    if (membership?.role !== 'owner') {
      throw new Error('FORBIDDEN: only the owner can delete the club');
    }
    await prisma.club.delete({ where: { id: clubId } });
  }

  /**
   * Invite friends to the club. Owner/admin only. Each target must be a friend
   * (mirrors challenge invitation rules) and not already a member or invitee.
   */
  async invite(clubId: string, inviterId: number, userIds: number[]): Promise<void> {
    await this.assertManage(clubId, inviterId);
    const unique = Array.from(new Set(userIds.filter((id) => id !== inviterId)));
    if (unique.length === 0) {
      return;
    }
    await this.friendsService.assertAllFriends(inviterId, unique);

    const existing = await prisma.clubMember.findMany({
      where: { clubId, userId: { in: unique } },
      select: { userId: true },
    });
    const existingIds = new Set(existing.map((m) => m.userId));
    const toInvite = unique.filter((id) => !existingIds.has(id));
    if (toInvite.length === 0) {
      return;
    }

    await prisma.clubMember.createMany({
      data: toInvite.map((uid) => ({
        clubId,
        userId: uid,
        role: 'member',
        status: 'pending_invite',
        invitedById: inviterId,
      })),
    });

    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { name: true },
    });
    if (club) {
      void this.dispatchInviteNotifications(inviterId, clubId, club.name, toInvite);
    }
  }

  /**
   * Accept a pending invite. The viewer must be the invitee.
   */
  async acceptInvite(clubId: string, viewerId: number): Promise<void> {
    const row = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    if (!row || row.status !== 'pending_invite') {
      throw new Error('No pending invite');
    }
    await prisma.clubMember.update({
      where: { id: row.id },
      data: { status: 'active', joinedAt: new Date() },
    });
    // Reflect the new member in the club chat (add participant + "joined").
    void conversationsService
      .onClubMemberJoined(clubId, viewerId)
      .catch((err) => console.error('[Clubs] chat join sync failed:', err));
  }

  /**
   * Decline a pending invite. Hard-deletes the row — re-inviting is fine.
   */
  async declineInvite(clubId: string, viewerId: number): Promise<void> {
    const row = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    if (!row || row.status !== 'pending_invite') {
      throw new Error('No pending invite');
    }
    await prisma.clubMember.delete({ where: { id: row.id } });
  }

  /**
   * Leave the club. The owner cannot leave directly — they must transfer
   * ownership first (deferred to a later milestone). Pending invites are
   * deleted; active members are removed entirely.
   */
  async leave(clubId: string, viewerId: number): Promise<void> {
    const row = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
    });
    if (!row) {
      throw new Error('Not a member of this club');
    }
    if (row.role === 'owner' && row.status === 'active') {
      throw new Error('Owner cannot leave; transfer ownership first');
    }
    const wasActive = row.status === 'active';
    await prisma.clubMember.delete({ where: { id: row.id } });
    // Only active members are in the chat — pending invitees leaving is a
    // decline, not a chat event.
    if (wasActive) {
      void conversationsService
        .onClubMemberLeft(clubId, viewerId)
        .catch((err) => console.error('[Clubs] chat leave sync failed:', err));
    }
  }

  /**
   * Change a member's role. Owner-only operation. Cannot demote yourself
   * (that would leave the club orphaned) — use `transferOwnership` for that.
   * Cannot set role to 'owner' here either — same reason.
   */
  async setMemberRole(
    clubId: string,
    viewerId: number,
    targetUserId: number,
    role: ClubRole
  ): Promise<void> {
    if (role === 'owner') {
      throw new Error('Use transferOwnership to change the owner');
    }
    if (role !== 'admin' && role !== 'member') {
      throw new Error('Invalid role');
    }
    const viewer = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
      select: { role: true },
    });
    if (viewer?.role !== 'owner') {
      throw new Error('FORBIDDEN: only the owner can change roles');
    }
    if (targetUserId === viewerId) {
      throw new Error('Cannot change your own role');
    }
    const target = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: targetUserId } },
      select: { id: true, role: true, status: true },
    });
    if (!target || target.status !== 'active') {
      throw new Error('User is not an active member of this club');
    }
    if (target.role === 'owner') {
      throw new Error('Cannot demote the owner');
    }
    await prisma.clubMember.update({ where: { id: target.id }, data: { role } });
  }

  /**
   * Kick a member from the club. Admins can kick regular members; only the
   * owner can kick other admins. The owner cannot be kicked at all (they must
   * transfer ownership or delete the club).
   */
  async kickMember(clubId: string, viewerId: number, targetUserId: number): Promise<void> {
    if (targetUserId === viewerId) {
      throw new Error('Use leave to remove yourself');
    }
    const viewer = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
      select: { role: true, status: true },
    });
    if (!viewer || viewer.status !== 'active') {
      throw new Error('FORBIDDEN: not a member');
    }
    if (viewer.role !== 'owner' && viewer.role !== 'admin') {
      throw new Error('FORBIDDEN: requires admin role');
    }
    const target = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: targetUserId } },
      select: { id: true, role: true },
    });
    if (!target) {
      throw new Error('User is not a member of this club');
    }
    if (target.role === 'owner') {
      throw new Error('Cannot kick the club owner');
    }
    if (target.role === 'admin' && viewer.role !== 'owner') {
      throw new Error('FORBIDDEN: only the owner can remove admins');
    }
    await prisma.clubMember.delete({ where: { id: target.id } });
    void conversationsService
      .onClubMemberLeft(clubId, targetUserId)
      .catch((err) => console.error('[Clubs] chat kick sync failed:', err));
  }

  /**
   * Transfer ownership of the club to another active member. The current owner
   * becomes an admin (so they keep their management privileges but the new
   * owner is now the only one who can delete or transfer again).
   */
  async transferOwnership(clubId: string, viewerId: number, targetUserId: number): Promise<void> {
    if (targetUserId === viewerId) {
      throw new Error('You are already the owner');
    }
    const viewer = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
      select: { id: true, role: true },
    });
    if (viewer?.role !== 'owner') {
      throw new Error('FORBIDDEN: only the owner can transfer ownership');
    }
    const target = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: targetUserId } },
      select: { id: true, status: true },
    });
    if (!target || target.status !== 'active') {
      throw new Error('Target user is not an active member of this club');
    }
    await prisma.$transaction([
      prisma.clubMember.update({ where: { id: viewer.id }, data: { role: 'admin' } }),
      prisma.clubMember.update({ where: { id: target.id }, data: { role: 'owner' } }),
    ]);
  }

  /**
   * Assert the viewer can manage the club (owner or admin).
   */
  private async assertManage(clubId: string, viewerId: number): Promise<void> {
    const row = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: viewerId } },
      select: { role: true, status: true },
    });
    if (!row || row.status !== 'active') {
      throw new Error('FORBIDDEN: not a member');
    }
    if (row.role !== 'owner' && row.role !== 'admin') {
      throw new Error('FORBIDDEN: requires admin role');
    }
  }

  /**
   * Emit `club_invite` notifications to a batch of invitees. Skips anyone with
   * a block in either direction with the inviter (privacy enforcement happens
   * inside `notificationEmitter.record`, but checking upfront avoids the
   * read-then-discard inside the emitter).
   */
  private async dispatchInviteNotifications(
    inviterId: number,
    clubId: string,
    clubName: string,
    inviteeIds: number[]
  ): Promise<void> {
    const inviter = await prisma.user.findUnique({
      where: { id: inviterId },
      select: { firstname: true, lastname: true },
    });
    if (!inviter) {
      return;
    }
    const inviterName = `${inviter.firstname} ${inviter.lastname}`;
    const blocked = await privacyService.getBlockedPair(inviterId);
    const targets = inviteeIds.filter((id) => !blocked.has(id));
    await Promise.all(
      targets.map((uid) =>
        notificationEmitter
          .record(
            uid,
            {
              type: 'club_invite',
              entityType: 'club',
              entityId: clubId,
              metadata: { clubName, inviterName },
            },
            { actorId: inviterId }
          )
          .catch((err) => console.error('[Inbox] club_invite emit failed:', err))
      )
    );
  }

  /**
   * Slugify the club name and append a numeric suffix until unique.
   * Slug is informational (used in URLs later); not user-visible right now.
   */
  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const root = base.length > 0 ? base : 'club';

    let candidate = root;
    let suffix = 1;
    // Linear probe — collisions are rare and capped at 50 attempts.
    while (suffix < 50) {
      const existing = await prisma.club.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
      suffix += 1;
      candidate = `${root}-${suffix}`;
    }
    // Fall back to a random suffix so we always succeed.
    return `${root}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export const clubsService = new ClubsService();

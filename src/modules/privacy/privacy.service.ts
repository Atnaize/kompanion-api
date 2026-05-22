import { prisma } from '@shared/utils/index.js';
import type { Prisma } from '@prisma/client';

const userPublicSelect = {
  id: true,
  stravaId: true,
  firstname: true,
  lastname: true,
  profile: true,
  profileMedium: true,
} satisfies Prisma.UserSelect;

type UserPublic = Prisma.UserGetPayload<{ select: typeof userPublicSelect }>;

/**
 * Privacy primitives: blocking (hard, bidirectional) and muting (soft, one-way).
 *
 * The single chokepoint for "is this user visible to that user" is `getHiddenIds`,
 * which other modules call to filter their query results. Block + mute are stored
 * in separate tables so we can reason about them independently and apply different
 * fan-out policies (e.g. mute hides feed events but doesn't suppress notifications).
 */
export class PrivacyService {
  /**
   * Block a user. Bidirectional invisibility takes effect immediately. As a side
   * effect, any existing friendship and pending friend requests between the two
   * are deleted (clean state — no zombie relationships).
   *
   * Idempotent: blocking twice is a no-op.
   */
  async block(blockerId: number, blockedId: number): Promise<void> {
    if (blockerId === blockedId) {
      throw new Error('Cannot block yourself');
    }
    const blocked = await prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true },
    });
    if (!blocked) {
      throw new Error('User not found');
    }

    await prisma.$transaction([
      prisma.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      }),
      // Drop any existing friendship or pending request in either direction.
      prisma.friendship.deleteMany({
        where: {
          OR: [
            { requesterId: blockerId, addresseeId: blockedId },
            { requesterId: blockedId, addresseeId: blockerId },
          ],
        },
      }),
      // Drop any mute the blocker had on the blocked user — block supersedes mute.
      prisma.userMute.deleteMany({
        where: { muterId: blockerId, mutedId: blockedId },
      }),
    ]);
  }

  /**
   * Unblock a user. Idempotent: unblocking when not blocked is a no-op.
   * Does NOT restore the prior friendship — users must re-friend manually.
   */
  async unblock(blockerId: number, blockedId: number): Promise<void> {
    await prisma.userBlock.deleteMany({
      where: { blockerId, blockedId },
    });
  }

  /**
   * Mute a user. One-way and soft: the muter no longer sees the muted user's
   * activity in feed/leaderboards, but friendship and notifications are unaffected.
   *
   * Idempotent. Refuses to mute someone you've already blocked (block is stronger).
   */
  async mute(muterId: number, mutedId: number): Promise<void> {
    if (muterId === mutedId) {
      throw new Error('Cannot mute yourself');
    }
    const muted = await prisma.user.findUnique({
      where: { id: mutedId },
      select: { id: true },
    });
    if (!muted) {
      throw new Error('User not found');
    }
    const existingBlock = await prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId: muterId, blockedId: mutedId } },
      select: { id: true },
    });
    if (existingBlock) {
      throw new Error('User is already blocked');
    }
    await prisma.userMute.upsert({
      where: { muterId_mutedId: { muterId, mutedId } },
      create: { muterId, mutedId },
      update: {},
    });
  }

  /**
   * Unmute a user. Idempotent.
   */
  async unmute(muterId: number, mutedId: number): Promise<void> {
    await prisma.userMute.deleteMany({
      where: { muterId, mutedId },
    });
  }

  /**
   * IDs of users the viewer has blocked + users who have blocked the viewer.
   * Used to enforce bidirectional invisibility — every "list of users" query that
   * could expose either side calls this and drops the intersection.
   */
  async getBlockedPair(viewerId: number): Promise<Set<number>> {
    const rows = await prisma.userBlock.findMany({
      where: {
        OR: [{ blockerId: viewerId }, { blockedId: viewerId }],
      },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<number>();
    for (const row of rows) {
      ids.add(row.blockerId === viewerId ? row.blockedId : row.blockerId);
    }
    return ids;
  }

  /**
   * IDs of users the viewer has muted. One-way: only includes users the viewer
   * personally muted. Mutes by other people don't affect the viewer.
   */
  async getMutedByViewer(viewerId: number): Promise<Set<number>> {
    const rows = await prisma.userMute.findMany({
      where: { muterId: viewerId },
      select: { mutedId: true },
    });
    return new Set(rows.map((r) => r.mutedId));
  }

  /**
   * Combined hidden set: blocked-either-direction + (optionally) muted-by-viewer.
   * Pass `includeMutes: false` for surfaces where the viewer should still see the
   * user (friends list, friend search) — only blocks apply there.
   */
  async getHiddenIds(
    viewerId: number,
    options: { includeMutes: boolean } = { includeMutes: true }
  ): Promise<Set<number>> {
    const [blocked, muted] = await Promise.all([
      this.getBlockedPair(viewerId),
      options.includeMutes ? this.getMutedByViewer(viewerId) : Promise.resolve(new Set<number>()),
    ]);
    for (const id of muted) {
      blocked.add(id);
    }
    return blocked;
  }

  /**
   * Returns true if there is a block in either direction. Used to short-circuit
   * mutating actions (friend requests, challenge invites) before they hit the DB.
   */
  async isBlockedEitherWay(viewerId: number, otherId: number): Promise<boolean> {
    const row = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: otherId },
          { blockerId: otherId, blockedId: viewerId },
        ],
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * List of users the viewer has blocked. Powers the Settings → Privacy screen.
   */
  async listBlocked(viewerId: number): Promise<UserPublic[]> {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: viewerId },
      include: { blocked: { select: userPublicSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => r.blocked);
  }

  /**
   * List of users the viewer has muted. Powers the Settings → Privacy screen.
   */
  async listMuted(viewerId: number): Promise<UserPublic[]> {
    const rows = await prisma.userMute.findMany({
      where: { muterId: viewerId },
      include: { muted: { select: userPublicSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => r.muted);
  }
}

export const privacyService = new PrivacyService();

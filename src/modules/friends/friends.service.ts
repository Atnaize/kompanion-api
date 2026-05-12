import { prisma } from '@shared/utils/index.js';
import type { Friendship, FriendshipStatus, Prisma } from '@prisma/client';
import { notificationEmitter } from '../inbox/index.js';

/**
 * One-shot view of a relationship between the current viewer and another user.
 * Drives both frontend UI (which button to render) and server-side privacy gating.
 */
export type FriendshipState = 'self' | 'friends' | 'pending_outgoing' | 'pending_incoming' | 'none';

const userPublicSelect = {
  id: true,
  stravaId: true,
  firstname: true,
  lastname: true,
  profile: true,
  profileMedium: true,
} satisfies Prisma.UserSelect;

type UserPublic = Prisma.UserGetPayload<{ select: typeof userPublicSelect }>;

export interface UserSearchResult extends UserPublic {
  friendshipState: FriendshipState;
}

export interface FriendshipWithUsers extends Friendship {
  requester: UserPublic;
  addressee: UserPublic;
}

/**
 * Normalizes a string for search by:
 * - Removing diacritics/accents (é→e, ü→u, ñ→n)
 * - Converting ligatures (æ→ae, œ→oe, ß→ss)
 * - Handling special characters (ø→o, đ→d, ł→l)
 * - Converting to lowercase
 * - Trimming whitespace
 */
function normalizeForSearch(str: string): string {
  return str
    .replace(/æ/gi, 'ae')
    .replace(/œ/gi, 'oe')
    .replace(/ß/g, 'ss')
    .replace(/ø/gi, 'o')
    .replace(/đ/gi, 'd')
    .replace(/ł/gi, 'l')
    .replace(/ħ/gi, 'h')
    .replace(/ŧ/gi, 't')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export class FriendsService {
  /**
   * Search Kompanion users by name and annotate each result with the viewer's
   * current friendship state. Powers the friend-search UI.
   *
   * Accent insensitive: "meg" finds "Mégane".
   * Ligature aware:    "ae"  finds "Ærodynamic".
   * Special-char aware: "o"   finds "Søren".
   */
  async searchUsers(query: string, currentUserId: number): Promise<UserSearchResult[]> {
    if (query.length < 2) {
      throw new Error('Search query must be at least 2 characters');
    }

    const normalizedQuery = normalizeForSearch(query);

    const users = await prisma.user.findMany({
      where: { id: { not: currentUserId } },
      select: userPublicSelect,
    });

    const filtered = users.filter((user) => {
      const fn = normalizeForSearch(user.firstname);
      const ln = normalizeForSearch(user.lastname);
      return fn.includes(normalizedQuery) || ln.includes(normalizedQuery);
    });

    const top = filtered.slice(0, 20);
    const stateMap = await this.buildStateMap(
      currentUserId,
      top.map((u) => u.id)
    );

    return top.map((user) => ({
      ...user,
      friendshipState: stateMap.get(user.id) ?? 'none',
    }));
  }

  /**
   * Returns the friendship state between the viewer and one specific user.
   * Used by profile lookups and any place that needs to render an action button.
   */
  async getFriendshipState(viewerId: number, otherId: number): Promise<FriendshipState> {
    if (viewerId === otherId) {
      return 'self';
    }
    const row = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: viewerId, addresseeId: otherId },
          { requesterId: otherId, addresseeId: viewerId },
        ],
      },
    });
    return this.rowToState(viewerId, row);
  }

  /**
   * Bulk variant of getFriendshipState. Used by searchUsers; reusable elsewhere
   * (e.g. annotating a list of activity authors with their friendship state).
   */
  async buildStateMap(viewerId: number, otherIds: number[]): Promise<Map<number, FriendshipState>> {
    const map = new Map<number, FriendshipState>();
    if (otherIds.length === 0) {
      return map;
    }
    const rows = await prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: viewerId, addresseeId: { in: otherIds } },
          { requesterId: { in: otherIds }, addresseeId: viewerId },
        ],
      },
    });
    for (const id of otherIds) {
      if (id === viewerId) {
        map.set(id, 'self');
        continue;
      }
      const row = rows.find(
        (r) =>
          (r.requesterId === viewerId && r.addresseeId === id) ||
          (r.requesterId === id && r.addresseeId === viewerId)
      );
      map.set(id, this.rowToState(viewerId, row ?? null));
    }
    return map;
  }

  /**
   * Returns the IDs of the viewer's accepted friends. Used by feed,
   * leaderboards, and any other "friends-only" query.
   */
  async listFriendIds(userId: number): Promise<number[]> {
    const rows = await prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  }

  /**
   * Single privacy chokepoint (abstraction A5). Throws if the viewer is neither
   * the target user nor an accepted friend. Every endpoint that exposes another
   * user's data must call this.
   */
  async assertFriendsOrSelf(viewerId: number, targetId: number): Promise<void> {
    if (viewerId === targetId) {
      return;
    }
    const exists = await prisma.friendship.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { requesterId: viewerId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: viewerId },
        ],
      },
      select: { id: true },
    });
    if (!exists) {
      throw new Error('FORBIDDEN: not friends');
    }
  }

  /**
   * Send a friend request. Behaviour:
   * - Self → error
   * - Already friends → error (409 semantics)
   * - Pending I already sent → idempotent, returns the existing row
   * - Pending they sent me → auto-accept and return the now-accepted row
   * - Otherwise → create new PENDING row
   */
  async sendRequest(requesterId: number, addresseeId: number): Promise<Friendship> {
    if (requesterId === addresseeId) {
      throw new Error('Cannot send a friend request to yourself');
    }
    const addressee = await prisma.user.findUnique({
      where: { id: addresseeId },
      select: { id: true },
    });
    if (!addressee) {
      throw new Error('User not found');
    }

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });

    if (existing) {
      if (existing.status === 'ACCEPTED') {
        throw new Error('Already friends');
      }
      // PENDING — two sub-cases
      if (existing.requesterId === requesterId) {
        // I already sent this request. Idempotent.
        return existing;
      }
      // They sent me a pending request. Treat my "send" as an accept.
      const accepted = await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      await this.notifyFriendAccepted(requesterId, existing.requesterId).catch((err) =>
        console.error('[Inbox] friend_accepted emit failed:', err)
      );
      return accepted;
    }

    const created = await prisma.friendship.create({
      data: {
        requesterId,
        addresseeId,
        status: 'PENDING',
      },
    });
    await this.notifyFriendRequest(requesterId, addresseeId).catch((err) =>
      console.error('[Inbox] friend_request emit failed:', err)
    );
    return created;
  }

  /** Drop a `friend_request` row in the addressee's inbox. */
  private async notifyFriendRequest(requesterId: number, addresseeId: number): Promise<void> {
    const actor = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { firstname: true, lastname: true },
    });
    if (!actor) return;
    await notificationEmitter.record(
      addresseeId,
      {
        type: 'friend_request',
        entityType: 'user',
        entityId: String(requesterId),
        metadata: { actorName: `${actor.firstname} ${actor.lastname}` },
      },
      { actorId: requesterId }
    );
  }

  /**
   * Drop a `friend_accepted` row in the ORIGINAL requester's inbox.
   * `accepterId` is whoever clicked accept; `originalRequesterId` is who gets notified.
   */
  private async notifyFriendAccepted(
    accepterId: number,
    originalRequesterId: number
  ): Promise<void> {
    const actor = await prisma.user.findUnique({
      where: { id: accepterId },
      select: { firstname: true, lastname: true },
    });
    if (!actor) return;
    await notificationEmitter.record(
      originalRequesterId,
      {
        type: 'friend_accepted',
        entityType: 'user',
        entityId: String(accepterId),
        metadata: { actorName: `${actor.firstname} ${actor.lastname}` },
      },
      { actorId: accepterId }
    );
  }

  /**
   * Accept a pending request. Only the addressee may accept.
   * `otherUserId` is the requester (the user who sent the request).
   */
  async acceptRequest(viewerId: number, otherUserId: number): Promise<Friendship> {
    const row = await prisma.friendship.findFirst({
      where: {
        requesterId: otherUserId,
        addresseeId: viewerId,
        status: 'PENDING',
      },
    });
    if (!row) {
      throw new Error('No pending request from this user');
    }
    const updated = await prisma.friendship.update({
      where: { id: row.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    // Notify the original requester that their request was accepted.
    await this.notifyFriendAccepted(viewerId, otherUserId).catch((err) =>
      console.error('[Inbox] friend_accepted emit failed:', err)
    );
    return updated;
  }

  /**
   * Cancel my outgoing request OR decline an incoming one. Either way, the
   * PENDING row is deleted. Hard delete is fine — re-sending creates a fresh row.
   */
  async cancelOrDeclineRequest(viewerId: number, otherUserId: number): Promise<void> {
    const row = await prisma.friendship.findFirst({
      where: {
        status: 'PENDING',
        OR: [
          { requesterId: viewerId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: viewerId },
        ],
      },
      select: { id: true },
    });
    if (!row) {
      throw new Error('No pending request to cancel');
    }
    await prisma.friendship.delete({ where: { id: row.id } });
  }

  /**
   * Remove an existing friendship. Either party may unfriend.
   */
  async unfriend(viewerId: number, otherUserId: number): Promise<void> {
    const row = await prisma.friendship.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { requesterId: viewerId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: viewerId },
        ],
      },
      select: { id: true },
    });
    if (!row) {
      throw new Error('Not friends');
    }
    await prisma.friendship.delete({ where: { id: row.id } });
  }

  async getFriends(userId: number): Promise<UserPublic[]> {
    const rows = await prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: userPublicSelect },
        addressee: { select: userPublicSelect },
      },
      orderBy: { acceptedAt: 'desc' },
    });
    return rows.map((row) => (row.requesterId === userId ? row.addressee : row.requester));
  }

  async getIncomingRequests(userId: number): Promise<FriendshipWithUsers[]> {
    const rows = await prisma.friendship.findMany({
      where: { addresseeId: userId, status: 'PENDING' },
      include: {
        requester: { select: userPublicSelect },
        addressee: { select: userPublicSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows;
  }

  async getOutgoingRequests(userId: number): Promise<FriendshipWithUsers[]> {
    const rows = await prisma.friendship.findMany({
      where: { requesterId: userId, status: 'PENDING' },
      include: {
        requester: { select: userPublicSelect },
        addressee: { select: userPublicSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows;
  }

  private rowToState(viewerId: number, row: Friendship | null): FriendshipState {
    if (!row) {
      return 'none';
    }
    if (row.status === ('ACCEPTED' as FriendshipStatus)) {
      return 'friends';
    }
    // PENDING
    return row.requesterId === viewerId ? 'pending_outgoing' : 'pending_incoming';
  }
}

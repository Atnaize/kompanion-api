import { prisma } from '@shared/utils/index.js';
import { FriendsService } from '../friends/friends.service.js';

/**
 * A FeedScope answers the one question that varies between feed flavours:
 * "whose events should the viewer see?" Everything else (pagination,
 * hydration, compare blocks, retention) is scope-agnostic and lives in
 * FeedService.
 *
 * To add a new feed flavour, implement this interface — no FeedService change
 * needed.
 */
export interface FeedScope {
  /**
   * Stable identifier embedded in the ETag so caches for different scopes
   * never collide. Must be deterministic for the same logical scope.
   */
  readonly scopeKey: string;

  /**
   * Actor ids whose events feed this scope. Always excludes the viewer
   * (feed is "what other people are doing"). Throws `FORBIDDEN: <reason>`
   * if the viewer can't access this scope.
   */
  resolveActorIds(viewerId: number): Promise<number[]>;
}

export class FriendsFeedScope implements FeedScope {
  readonly scopeKey = 'friends';

  constructor(private friendsService: FriendsService = new FriendsService()) {}

  resolveActorIds(viewerId: number): Promise<number[]> {
    return this.friendsService.listFriendIds(viewerId);
  }
}

export class ClubFeedScope implements FeedScope {
  readonly scopeKey: string;

  constructor(private clubId: string) {
    this.scopeKey = `club:${clubId}`;
  }

  async resolveActorIds(viewerId: number): Promise<number[]> {
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId: this.clubId, userId: viewerId } },
      select: { status: true },
    });
    if (!membership || membership.status !== 'active') {
      throw new Error('FORBIDDEN: not a club member');
    }

    const rows = await prisma.clubMember.findMany({
      where: { clubId: this.clubId, status: 'active', userId: { not: viewerId } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}

/**
 * Union of multiple scopes — actor ids are de-duplicated so a user who is
 * both a friend and a club member contributes one row per event, not two.
 *
 * Sub-scopes are resolved in parallel. If any sub-scope throws (e.g. the
 * viewer isn't a member of one of the requested clubs), the composite
 * throws too — partial-permission semantics would be confusing.
 */
export class CompositeFeedScope implements FeedScope {
  readonly scopeKey: string;

  constructor(private scopes: FeedScope[]) {
    if (scopes.length === 0) {
      throw new Error('CompositeFeedScope requires at least one sub-scope');
    }
    this.scopeKey = `mixed:${scopes
      .map((s) => s.scopeKey)
      .sort()
      .join('+')}`;
  }

  async resolveActorIds(viewerId: number): Promise<number[]> {
    const lists = await Promise.all(this.scopes.map((s) => s.resolveActorIds(viewerId)));
    return [...new Set(lists.flat())];
  }
}

import type { Request, Response } from 'express';
import { FeedService } from './feed.service.js';
import {
  ClubFeedScope,
  CompositeFeedScope,
  FriendsFeedScope,
  type FeedScope,
} from './feed.scopes.js';

function buildScope(query: Request['query']): FeedScope {
  const clubId = typeof query.clubId === 'string' ? query.clubId : undefined;
  const mix = query.mix === 'true' || query.mix === '1';

  if (clubId && mix) {
    return new CompositeFeedScope([new FriendsFeedScope(), new ClubFeedScope(clubId)]);
  }
  if (clubId) {
    return new ClubFeedScope(clubId);
  }
  return new FriendsFeedScope();
}

export class FeedController {
  private feedService = new FeedService();

  /**
   * GET /api/feed?cursor=<id>&limit=<n>&since=<ISO>
   *
   * Cursor-paginated feed of events from the viewer's friends.
   *
   * Supports conditional GET via ETag — open tabs polling at the top of the
   * feed (no cursor, no since change) get a cheap 304 when nothing has
   * happened. The signature query is one indexed `findFirst`; only on a real
   * change do we do the heavy `findMany` + hydration.
   *
   * `?since=<ISO>` is the companion incremental-load case: clients pass the
   * timestamp of the newest event they've seen and we only return rows newer
   * than that.
   */
  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
        res.status(400).json({ success: false, error: 'Invalid limit' });
        return;
      }

      let since: Date | undefined;
      if (typeof req.query.since === 'string') {
        const parsed = new Date(req.query.since);
        if (isNaN(parsed.getTime())) {
          res
            .status(400)
            .json({ success: false, error: 'Invalid since parameter. Use ISO 8601 format.' });
          return;
        }
        since = parsed;
      }

      const scope = buildScope(req.query);

      const { etag } = await this.feedService.computeSignature(userId, scope);

      // Always advertise the ETag so the client can use it on the next poll.
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, no-cache');

      // 304 only makes sense for the polling case (top of feed, no cursor).
      // Paginated requests for older pages still need a body even when nothing
      // new has been emitted — the cursor is what changed, not the latest event.
      if (!cursor) {
        const clientETag = req.headers['if-none-match'];
        if (clientETag && clientETag === etag) {
          res.status(304).end();
          return;
        }
      }

      const page = await this.feedService.getFeed(userId, scope, cursor, limit, since);
      res.status(200).json({ success: true, data: page });
    } catch (error) {
      if (error instanceof Error) {
        const status =
          error.message === 'Invalid cursor'
            ? 400
            : error.message.startsWith('FORBIDDEN')
              ? 403
              : 500;
        res.status(status).json({ success: false, error: error.message });
        return;
      }
      console.error('[Feed Controller] List error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

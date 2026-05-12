import type { Request, Response } from 'express';
import { FeedService } from './feed.service.js';

export class FeedController {
  private feedService = new FeedService();

  /**
   * GET /api/feed?cursor=<id>&limit=<n>
   * Cursor-paginated feed of events from the viewer's friends.
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

      const page = await this.feedService.getFeed(userId, cursor, limit);
      res.status(200).json({ success: true, data: page });
    } catch (error) {
      if (error instanceof Error) {
        const status = error.message === 'Invalid cursor' ? 400 : 500;
        res.status(status).json({ success: false, error: error.message });
        return;
      }
      console.error('[Feed Controller] List error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

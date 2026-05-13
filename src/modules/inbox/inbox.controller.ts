import type { Request, Response } from 'express';
import { InboxService } from './inbox.service.js';

export class InboxController {
  private inboxService = new InboxService();

  /**
   * GET /api/inbox?cursor=<id>&limit=<n>
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
      const page = await this.inboxService.list(userId, cursor, limit);
      res.status(200).json({ success: true, data: page });
    } catch (error) {
      if (error instanceof Error) {
        const status = error.message === 'Invalid cursor' ? 400 : 500;
        res.status(status).json({ success: false, error: error.message });
        return;
      }
      console.error('[Inbox] list error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/inbox/count — unread notifications count.
   */
  unreadCount = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const count = await this.inboxService.unreadCount(userId);
      res.status(200).json({ success: true, data: { count } });
    } catch (error) {
      console.error('[Inbox] count error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/inbox/:id/read
   */
  markRead = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      await this.inboxService.markRead(userId, req.params.id);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        const status =
          error.message === 'Notification not found'
            ? 404
            : error.message === 'Invalid notification id'
              ? 400
              : 500;
        res.status(status).json({ success: false, error: error.message });
        return;
      }
      console.error('[Inbox] markRead error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/inbox/read-all
   */
  markAllRead = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const count = await this.inboxService.markAllRead(userId);
      res.status(200).json({ success: true, data: { count } });
    } catch (error) {
      console.error('[Inbox] markAllRead error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/inbox/:id
   */
  deleteOne = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      await this.inboxService.deleteOne(userId, req.params.id);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        const status =
          error.message === 'Notification not found'
            ? 404
            : error.message === 'Invalid notification id'
              ? 400
              : 500;
        res.status(status).json({ success: false, error: error.message });
        return;
      }
      console.error('[Inbox] deleteOne error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/inbox
   */
  deleteAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const count = await this.inboxService.deleteAll(userId);
      res.status(200).json({ success: true, data: { count } });
    } catch (error) {
      console.error('[Inbox] deleteAll error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

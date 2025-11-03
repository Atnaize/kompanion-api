import type { Request, Response } from 'express';
import { FriendsService } from './friends.service.js';

export class FriendsController {
  private friendsService: FriendsService;

  constructor() {
    this.friendsService = new FriendsService();
  }

  /**
   * GET /api/friends/search
   * Search for Kompanion users by name
   */
  searchUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { q } = req.query;

      if (!q || typeof q !== 'string') {
        res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
        return;
      }

      const users = await this.friendsService.searchUsers(q, userId);

      res.status(200).json({ success: true, data: users });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

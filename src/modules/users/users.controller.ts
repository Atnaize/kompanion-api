import type { Request, Response } from 'express';
import { UsersService } from './users.service.js';

export class UsersController {
  private usersService = new UsersService();

  /**
   * GET /api/users/:id/profile
   * Returns a profile shape that depends on the viewer's relationship to the
   * target (self / friends / pending / none). See UsersService.getProfile.
   */
  getProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const targetId = Number(req.params.id);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        res.status(400).json({ success: false, error: 'Invalid user id' });
        return;
      }
      const profile = await this.usersService.getProfile(userId, targetId);
      res.status(200).json({ success: true, data: profile });
    } catch (error) {
      if (error instanceof Error) {
        const status = error.message === 'User not found' ? 404 : 400;
        res.status(status).json({ success: false, error: error.message });
        return;
      }
      console.error('[Users Controller] Get profile error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

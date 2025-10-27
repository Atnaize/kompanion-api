import type { Request, Response, NextFunction } from 'express';
import { AchievementsService } from './achievements.service.js';
import { HttpStatus } from '@shared/types/index.js';

export class AchievementsController {
  private achievementsService = new AchievementsService();

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user: sessionUser } = req.session;

      if (!sessionUser) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const achievements = await this.achievementsService.getUserAchievements(sessionUser.userId);

      res.json({
        success: true,
        data: achievements,
      });
    } catch (error) {
      next(error);
    }
  };
}

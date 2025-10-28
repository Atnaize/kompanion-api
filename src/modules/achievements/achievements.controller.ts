import type { Request, Response, NextFunction } from 'express';
import { AchievementsService } from './achievements.service.js';
import { HttpStatus } from '@shared/types/index.js';

export class AchievementsController {
  private achievementsService = new AchievementsService();

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const achievements = await this.achievementsService.getUserAchievements(req.userId);

      res.json({
        success: true,
        data: achievements,
      });
    } catch (error) {
      next(error);
    }
  };

  redeem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const { achievementId } = req.params;

      if (!achievementId) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Achievement ID is required',
        });
        return;
      }

      const achievement = await this.achievementsService.redeemAchievement(
        req.userId,
        achievementId
      );

      res.json({
        success: true,
        data: achievement,
      });
    } catch (error) {
      if (error instanceof Error) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: error.message,
        });
        return;
      }
      next(error);
    }
  };
}

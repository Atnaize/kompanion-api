import type { Request, Response, NextFunction } from 'express';
import { StatsService } from './stats.service.js';
import { HttpStatus } from '@shared/types/index.js';

export class StatsController {
  private statsService = new StatsService();

  getUserStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user: sessionUser } = req.session;

      if (!sessionUser) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const stats = await this.statsService.calculateUserStats(sessionUser.userId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  };
}

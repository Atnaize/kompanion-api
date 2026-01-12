import type { Request, Response, NextFunction } from 'express';
import { TrainingService } from './training.service.js';
import { HttpStatus } from '@shared/types/index.js';

export class TrainingController {
  private trainingService = new TrainingService();

  /**
   * GET /api/training/program
   * Get the full marathon training program
   */
  getProgram = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const program = this.trainingService.getProgram();

      res.json({
        success: true,
        data: program,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/training/week/:weekNumber
   * Get a specific week from the training program
   */
  getWeek = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const weekNumber = parseInt(req.params.weekNumber, 10);

      if (isNaN(weekNumber) || weekNumber < 1 || weekNumber > 14) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid week number. Must be between 1 and 14.',
        });
        return;
      }

      const week = this.trainingService.getWeek(weekNumber);

      if (!week) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: `Week ${weekNumber} not found`,
        });
        return;
      }

      res.json({
        success: true,
        data: week,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/training/current-week
   * Get the current week based on today's date
   */
  getCurrentWeek = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentWeek = this.trainingService.getCurrentWeek();

      if (!currentWeek) {
        res.json({
          success: true,
          data: null,
          message: 'No active training week for today',
        });
        return;
      }

      res.json({
        success: true,
        data: currentWeek,
      });
    } catch (error) {
      next(error);
    }
  };
}

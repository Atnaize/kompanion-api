import type { Request, Response, NextFunction } from 'express';
import { QuestsService } from './quests.service.js';
import { HttpStatus } from '@shared/types/index.js';

export class QuestsController {
  private questsService = new QuestsService();

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const quests = await this.questsService.getUserQuests(req.userId);

      res.json({
        success: true,
        data: quests,
      });
    } catch (error) {
      next(error);
    }
  };
}

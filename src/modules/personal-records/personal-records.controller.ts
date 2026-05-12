import type { Request, Response, NextFunction } from 'express';
import {
  PersonalRecordsService,
  PR_BANDS,
  type BacklogProgressEvent,
  type PersonalRecordWithActivity,
} from './personal-records.service.js';
import { AuthService } from '../auth/auth.service.js';
import { HttpStatus } from '@shared/types/index.js';

export class PersonalRecordsController {
  private personalRecordsService = new PersonalRecordsService();
  private authService = new AuthService();

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const grouped = await this.personalRecordsService.getRecordsGroupedByBand(req.userId, 3);

      const data = PR_BANDS.map(({ band, meters }) => ({
        band,
        distanceMeters: meters,
        records: (grouped[band] ?? []).map(formatRecord),
      }));

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

  status = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({ success: false, error: 'Not authenticated' });
        return;
      }
      const data = await this.personalRecordsService.getProcessingStatus(req.userId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

  processStream = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.stravaId) {
        res.status(HttpStatus.UNAUTHORIZED).json({ success: false, error: 'Not authenticated' });
        return;
      }

      const user = await this.authService.getUserByStravaId(req.stravaId);
      if (!user) {
        res.status(HttpStatus.NOT_FOUND).json({ success: false, error: 'User not found' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const send = (event: BacklogProgressEvent): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        await this.personalRecordsService.processBacklogWithProgress(user, send);
        res.end();
      } catch (error) {
        console.error('[PR Stream] Unexpected error:', error);
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Processing failed',
        });
        res.end();
      }
    } catch (error) {
      console.error('[PR Stream] Setup error:', error);
      next(error);
    }
  };
}

function formatRecord(record: PersonalRecordWithActivity): {
  bestTimeSeconds: number;
  achievedAt: string;
  activity: { id: string; name: string };
} {
  return {
    bestTimeSeconds: record.bestTimeSeconds,
    achievedAt: record.achievedAt.toISOString(),
    activity: record.activity,
  };
}

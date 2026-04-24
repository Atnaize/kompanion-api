import type { Request, Response, NextFunction } from 'express';
import {
  PersonalRecordsService,
  PR_BANDS,
  type PersonalRecordWithActivity,
} from './personal-records.service.js';
import { HttpStatus } from '@shared/types/index.js';

export class PersonalRecordsController {
  private personalRecordsService = new PersonalRecordsService();

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

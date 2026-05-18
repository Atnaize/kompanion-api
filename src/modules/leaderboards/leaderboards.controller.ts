import type { Request, Response, NextFunction } from 'express';
import { LeaderboardsService } from './leaderboards.service.js';
import {
  isLeaderboardPeriod,
  isMetricKey,
  METRIC_KEYS,
  LEADERBOARD_PERIODS,
} from '../stats/metric-registry.js';
import { HttpStatus } from '@shared/types/index.js';

const pluckType = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') return undefined;
  return trimmed;
};

export class LeaderboardsController {
  private leaderboardsService = new LeaderboardsService();

  getFriendsLeaderboard = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({ success: false, error: 'Not authenticated' });
        return;
      }

      const metric = req.query.metric;
      if (!isMetricKey(metric)) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: `Invalid metric. Must be one of: ${METRIC_KEYS.join(', ')}`,
        });
        return;
      }

      const period = req.query.period ?? 'month';
      if (!isLeaderboardPeriod(period)) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: `Invalid period. Must be one of: ${LEADERBOARD_PERIODS.join(', ')}`,
        });
        return;
      }

      const data = await this.leaderboardsService.getFriendsLeaderboard({
        viewerId: req.userId,
        metric,
        period,
        activityType: pluckType(req.query.activityType),
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };
}

import type { Request, Response, NextFunction } from 'express';
import { StatsService } from './stats.service.js';
import { HttpStatus } from '@shared/types/index.js';

export class StatsController {
  private statsService = new StatsService();

  getUserStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const period = req.query.period as string | undefined;

      // Validate period if provided
      if (period && !['week', 'month', 'year'].includes(period)) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid period. Must be: week, month, or year',
        });
        return;
      }

      const stats = period
        ? await this.statsService.calculateStatsForPeriod(
            req.userId,
            period as 'week' | 'month' | 'year'
          )
        : await this.statsService.calculateUserStats(req.userId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  };

  getProgressData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const metric = (req.query.metric as string) || 'distance';
      const period = (req.query.period as string) || 'month';
      const groupBy = (req.query.groupBy as string) || 'week';

      // Validate parameters
      if (!['distance', 'elevation', 'count', 'time'].includes(metric)) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid metric. Must be: distance, elevation, count, or time',
        });
        return;
      }

      if (!['week', 'month', 'year', 'all'].includes(period)) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid period. Must be: week, month, year, or all',
        });
        return;
      }

      if (!['day', 'week', 'month'].includes(groupBy)) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid groupBy. Must be: day, week, or month',
        });
        return;
      }

      const data = await this.statsService.getProgressData(req.userId, {
        metric: metric as 'distance' | 'elevation' | 'count' | 'time',
        period: period as 'week' | 'month' | 'year' | 'all',
        groupBy: groupBy as 'day' | 'week' | 'month',
      });

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  comparePeriods = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const period = (req.query.period as string) || 'week';

      // Validate parameters
      if (!['week', 'month', 'year'].includes(period)) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid period. Must be: week, month, or year',
        });
        return;
      }

      const data = await this.statsService.comparePeriods(
        req.userId,
        period as 'week' | 'month' | 'year'
      );

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  getHeatmapData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const metric = (req.query.metric as string) || 'count';

      // Validate parameters
      if (!['count', 'distance'].includes(metric)) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid metric. Must be: count or distance',
        });
        return;
      }

      const data = await this.statsService.getHeatmapData(
        req.userId,
        metric as 'count' | 'distance'
      );

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  compareCustomRanges = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const { currentStart, currentEnd, previousStart, previousEnd } = req.query;

      // Validate parameters
      if (!currentStart || !currentEnd || !previousStart || !previousEnd) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error:
            'Missing required parameters: currentStart, currentEnd, previousStart, previousEnd',
        });
        return;
      }

      // Parse dates
      const currentStartDate = new Date(currentStart as string);
      const currentEndDate = new Date(currentEnd as string);
      const previousStartDate = new Date(previousStart as string);
      const previousEndDate = new Date(previousEnd as string);

      // Validate dates
      if (
        Number.isNaN(currentStartDate.getTime()) ||
        Number.isNaN(currentEndDate.getTime()) ||
        Number.isNaN(previousStartDate.getTime()) ||
        Number.isNaN(previousEndDate.getTime())
      ) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD)',
        });
        return;
      }

      const data = await this.statsService.compareCustomDateRanges(
        req.userId,
        currentStartDate,
        currentEndDate,
        previousStartDate,
        previousEndDate
      );

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}

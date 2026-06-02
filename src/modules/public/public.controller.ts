import type { Request, Response, NextFunction } from 'express';
import { prisma } from '@shared/utils/index.js';
import { config } from '@config/env.js';
import { HttpStatus } from '@shared/types/index.js';
import { StatsService } from '../stats/stats.service.js';

/**
 * Unauthenticated, read-only stats for the configured owner. Powers the public
 * portfolio site (ed-solutions.be). Exposes only this-year totals for a single
 * curated user — never an arbitrary one — so it leaks nothing private.
 */
export class PublicController {
  private statsService = new StatsService();

  getStats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ownerId = await this.resolveOwnerId();

      if (!ownerId) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'Public stats are not configured',
        });
        return;
      }

      const stats = await this.statsService.calculateStatsForPeriod(ownerId, 'year');

      // Edge-cache for an hour; serve stale for a day while revalidating. The
      // numbers only move when a new activity syncs, so this is plenty fresh.
      res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      res.json({
        success: true,
        data: {
          year: new Date().getFullYear(),
          distance: stats.totalDistance,
          elevation: stats.totalElevation,
          movingTime: stats.totalTime,
          activities: stats.totalActivities,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  private async resolveOwnerId(): Promise<number | null> {
    if (config.publicStats.userId) {
      return config.publicStats.userId;
    }

    const admin = await prisma.user.findFirst({
      where: { isAdmin: true },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    return admin?.id ?? null;
  }
}

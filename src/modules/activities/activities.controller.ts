import type { Request, Response, NextFunction } from 'express';
import { ActivitiesService } from './activities.service.js';
import { AuthService } from '../auth/auth.service.js';
import { HttpStatus } from '@shared/types/index.js';
import { validateNumericId } from '@shared/utils/index.js';

export class ActivitiesController {
  private activitiesService = new ActivitiesService();
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

      const activities = await this.activitiesService.getUserActivities(req.userId);

      res.json({
        success: true,
        data: activities,
      });
    } catch (error) {
      next(error);
    }
  };

  sync = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.stravaId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const user = await this.authService.getUserByStravaId(req.stravaId);

      if (!user) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      const result = await this.activitiesService.syncActivities(user);

      res.json({
        success: true,
        data: result,
        message: `Synced ${result.synced} new activities`,
      });
    } catch (error) {
      next(error);
    }
  };

  syncWithProgress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      console.info('[Sync] Starting sync with progress - stravaId:', req.stravaId, 'userId:', req.userId);

      if (!req.stravaId) {
        console.warn('[Sync] Failed: stravaId not found in request');
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const user = await this.authService.getUserByStravaId(req.stravaId);

      if (!user) {
        console.warn('[Sync] Failed: User not found for stravaId:', req.stravaId);
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      console.info('[Sync] User found:', user.id, '- starting sync');

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const sendEvent = (data: {
        type: 'fetching' | 'saving' | 'complete' | 'error';
        current?: number;
        total?: number;
        message?: string;
        challengesSynced?: number;
        challengeActivitiesAdded?: number;
      }): void => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const result = await this.activitiesService.syncActivitiesWithProgress(user, sendEvent);

        console.info('[Sync] Completed successfully - synced:', result.synced);

        sendEvent({
          type: 'complete',
          total: result.synced,
          message: `Synced ${result.synced} activities`,
          challengesSynced: result.challengesSynced,
          challengeActivitiesAdded: result.challengeActivitiesAdded,
        });

        res.end();
      } catch (error) {
        console.error('[Sync] Error during sync:', error instanceof Error ? error.message : error);
        sendEvent({
          type: 'error',
          message: error instanceof Error ? error.message : 'Sync failed',
        });
        res.end();
      }
    } catch (error) {
      console.error('[Sync] Unexpected error:', error);
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      if (!req.stravaId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      // Validate activity ID
      const validation = validateNumericId(id);
      if (!validation.isValid) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: validation.error || 'Invalid activity ID',
        });
        return;
      }

      const activityId = parseInt(id, 10);

      const user = await this.authService.getUserByStravaId(req.stravaId);

      if (!user) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      // Fetch detailed activity with segment efforts from Strava
      const activity = await this.activitiesService.getDetailedActivityById(activityId, user);

      if (!activity) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'Activity not found',
        });
        return;
      }

      res.json({
        success: true,
        data: activity,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/activities/test/delete
   * Delete activities for testing (cleans up all related data)
   */
  deleteActivitiesForTest = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const { activityIds } = req.body as { activityIds?: number[] };

      if (!activityIds || !Array.isArray(activityIds) || activityIds.length === 0) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'activityIds array is required',
        });
        return;
      }

      const result = await this.activitiesService.deleteActivitiesAndRecalculate(
        req.userId,
        activityIds
      );

      res.json({
        success: true,
        data: result,
        message: `Deleted ${result.deleted} activities, removed ${result.challengeActivitiesRemoved} challenge activities, updated ${result.challengesUpdated} challenge(s)`,
      });
    } catch (error) {
      next(error);
    }
  };
}

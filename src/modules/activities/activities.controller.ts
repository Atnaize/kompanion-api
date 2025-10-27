import type { Request, Response, NextFunction } from 'express';
import { ActivitiesService } from './activities.service.js';
import { AuthService } from '../auth/auth.service.js';
import { HttpStatus } from '@shared/types/index.js';

export class ActivitiesController {
  private activitiesService = new ActivitiesService();
  private authService = new AuthService();

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user: sessionUser } = req.session;

      if (!sessionUser) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const activities = await this.activitiesService.getUserActivities(sessionUser.userId);

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
      const { user: sessionUser } = req.session;

      if (!sessionUser) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const user = await this.authService.getUserByStravaId(sessionUser.stravaId);

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
      const { user: sessionUser } = req.session;

      if (!sessionUser) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const user = await this.authService.getUserByStravaId(sessionUser.stravaId);

      if (!user) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const sendEvent = (data: {
        type: 'fetching' | 'saving' | 'complete' | 'error';
        current?: number;
        total?: number;
        message?: string;
      }): void => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const result = await this.activitiesService.syncActivitiesWithProgress(user, sendEvent);

        // Update session with fresh user data (including lastSyncedAt)
        const updatedUser = await this.authService.getUserByStravaId(sessionUser.stravaId);
        if (updatedUser) {
          req.session.user = this.authService.createSession(updatedUser);
        }

        sendEvent({
          type: 'complete',
          total: result.synced,
          message: `Synced ${result.synced} activities`,
        });

        res.end();
      } catch (error) {
        sendEvent({
          type: 'error',
          message: error instanceof Error ? error.message : 'Sync failed',
        });
        res.end();
      }
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user: sessionUser } = req.session;
      const { id } = req.params;

      if (!sessionUser) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const activityId = parseInt(id, 10);

      if (isNaN(activityId)) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid activity ID',
        });
        return;
      }

      const activity = await this.activitiesService.getActivityById(activityId, sessionUser.userId);

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
}

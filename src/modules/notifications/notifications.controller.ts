import type { Request, Response, NextFunction } from 'express';
import { NotificationsService } from './notifications.service.js';
import { HttpStatus } from '@shared/types/index.js';
import type { PushSubscription } from 'web-push';
import { config } from '@config/env.js';

export class NotificationsController {
  private notificationsService = new NotificationsService();

  subscribe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const { subscription } = req.body as { subscription?: unknown };

      if (!subscription || typeof subscription !== 'object') {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid subscription object',
        });
        return;
      }

      const userAgent = req.headers['user-agent'];

      await this.notificationsService.subscribe(
        req.userId,
        subscription as PushSubscription,
        userAgent
      );

      res.json({
        success: true,
        message: 'Push subscription saved',
      });
    } catch (error) {
      next(error);
    }
  };

  unsubscribe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const { endpoint } = req.body as { endpoint?: unknown };

      if (!endpoint || typeof endpoint !== 'string') {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid endpoint',
        });
        return;
      }

      await this.notificationsService.unsubscribe(req.userId, endpoint);

      res.json({
        success: true,
        message: 'Push subscription removed',
      });
    } catch (error) {
      next(error);
    }
  };

  getPreferences = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const preferences = await this.notificationsService.getPreferences(req.userId);

      res.json({
        success: true,
        data: preferences,
      });
    } catch (error) {
      next(error);
    }
  };

  updatePreferences = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      const updates = req.body as {
        challengeInvites?: unknown;
        achievementUnlocks?: unknown;
        challengeProgress?: unknown;
        challengeReminders?: unknown;
      };

      const validatedUpdates: {
        challengeInvites?: boolean;
        achievementUnlocks?: boolean;
        challengeProgress?: boolean;
        challengeReminders?: boolean;
      } = {};

      if (typeof updates.challengeInvites === 'boolean') {
        validatedUpdates.challengeInvites = updates.challengeInvites;
      }
      if (typeof updates.achievementUnlocks === 'boolean') {
        validatedUpdates.achievementUnlocks = updates.achievementUnlocks;
      }
      if (typeof updates.challengeProgress === 'boolean') {
        validatedUpdates.challengeProgress = updates.challengeProgress;
      }
      if (typeof updates.challengeReminders === 'boolean') {
        validatedUpdates.challengeReminders = updates.challengeReminders;
      }

      const preferences = await this.notificationsService.updatePreferences(
        req.userId,
        validatedUpdates
      );

      res.json({
        success: true,
        data: preferences,
      });
    } catch (error) {
      next(error);
    }
  };

  getVapidPublicKey = (_req: Request, res: Response): void => {
    res.json({
      success: true,
      data: {
        publicKey: config.vapid.publicKey,
      },
    });
  };

  sendTestNotification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({
          success: false,
          error: 'Not authenticated',
        });
        return;
      }

      await this.notificationsService.sendToUser(req.userId, {
        title: 'Test Notification',
        body: 'This is a test notification from Kompanion!',
        icon: '/pwa-192x192.svg',
        data: {
          type: 'test',
          timestamp: new Date().toISOString(),
        },
      });

      res.json({
        success: true,
        message: 'Test notification sent',
      });
    } catch (error) {
      next(error);
    }
  };
}

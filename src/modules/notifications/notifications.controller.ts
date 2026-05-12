import type { Request, Response, NextFunction } from 'express';
import { NotificationsService } from './notifications.service.js';
import { HttpStatus } from '@shared/types/index.js';
import type { PushSubscription } from 'web-push';
import { config } from '@config/env.js';
import { prisma } from '@shared/utils/index.js';

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

      const updates = req.body as Record<string, unknown>;

      const validatedUpdates: {
        challengeInvites?: boolean;
        challengeProgress?: boolean;
        challengeReminders?: boolean;
        friendRequests?: boolean;
        friendAccepted?: boolean;
        achievementUnlocked?: boolean;
      } = {};

      const boolFields = [
        'challengeInvites',
        'challengeProgress',
        'challengeReminders',
        'friendRequests',
        'friendAccepted',
        'achievementUnlocked',
      ] as const;
      for (const field of boolFields) {
        if (typeof updates[field] === 'boolean') {
          validatedUpdates[field] = updates[field];
        }
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

      const userId = req.userId;

      // Check if user has any subscriptions
      const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId },
      });

      if (subscriptions.length === 0) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'No push subscriptions found for this user',
          hint: 'Make sure you have enabled notifications in the PWA',
        });
        return;
      }

      console.info(
        `[Notifications] Sending test to user ${userId} with ${subscriptions.length} subscription(s)`
      );

      // Log subscription details for debugging
      subscriptions.forEach((sub, i) => {
        console.info(
          `[Notifications] Subscription ${i + 1}: endpoint=${sub.endpoint.substring(0, 50)}...`
        );
      });

      // Send test notification
      await this.notificationsService.sendToUser(userId, {
        title: 'Test Notification',
        body: 'This is a test notification from Kompanion!',
        icon: '/pwa-192x192.svg',
        badge: '/pwa-64x64.svg',
        data: {
          type: 'test',
          timestamp: new Date().toISOString(),
        },
      });

      console.info('[Notifications] Test notification sent successfully');

      res.json({
        success: true,
        message: 'Test notification sent',
        subscriptionCount: subscriptions.length,
      });
    } catch (error) {
      console.error('[Notifications] Test notification failed:', error);
      next(error);
    }
  };
}

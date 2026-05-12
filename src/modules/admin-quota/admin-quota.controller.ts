import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AdminQuotaService } from './admin-quota.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import { AuthService } from '../auth/auth.service.js';
import {
  PersonalRecordsService,
  type BacklogProgressEvent,
} from '../personal-records/personal-records.service.js';
import { HttpStatus } from '@shared/types/index.js';

const grantSchema = z.object({
  userId: z.number().int().positive(),
  amount: z.number().int().positive().max(10_000),
  kind: z.enum(['pr_fetch', 'webhook_fetch', 'activity_sync']).optional(),
  validUntil: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  note: z.string().max(500).optional(),
});

export class AdminQuotaController {
  private service = new AdminQuotaService();
  private authService = new AuthService();
  private activitiesService = new ActivitiesService();
  private personalRecordsService = new PersonalRecordsService();

  overview = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await this.service.getOverview() });
    } catch (error) {
      next(error);
    }
  };

  users = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dateParam = typeof req.query.date === 'string' ? req.query.date : undefined;
      const date = dateParam ? new Date(`${dateParam}T00:00:00Z`) : new Date();
      if (Number.isNaN(date.getTime())) {
        res
          .status(HttpStatus.BAD_REQUEST)
          .json({ success: false, error: 'Invalid date (expected YYYY-MM-DD)' });
        return;
      }
      const activeOnly = req.query.activeOnly === 'true';
      res.json({ success: true, data: await this.service.getUsersForDate(date, activeOnly) });
    } catch (error) {
      next(error);
    }
  };

  backlog = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await this.service.getBacklog() });
    } catch (error) {
      next(error);
    }
  };

  createGrant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(HttpStatus.UNAUTHORIZED).json({ success: false, error: 'Not authenticated' });
        return;
      }
      const parsed = grantSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid grant payload',
          details: parsed.error.flatten(),
        });
        return;
      }
      const grant = await this.service.grantQuota({
        ...parsed.data,
        grantedBy: req.userId,
      });
      res.status(HttpStatus.CREATED).json({ success: true, data: grant });
    } catch (error) {
      next(error);
    }
  };

  revokeGrant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseInt(req.params.id ?? '', 10);
      if (Number.isNaN(id) || id <= 0) {
        res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'Invalid grant id' });
        return;
      }
      await this.service.revokeGrant(id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  };

  listGrants = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = parseInt(typeof req.query.userId === 'string' ? req.query.userId : '', 10);
      if (Number.isNaN(userId) || userId <= 0) {
        res
          .status(HttpStatus.BAD_REQUEST)
          .json({ success: false, error: 'userId query param is required' });
        return;
      }
      res.json({ success: true, data: await this.service.listGrantsForUser(userId) });
    } catch (error) {
      next(error);
    }
  };

  syncUserActivitiesStream = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const targetUserId = parseInt(req.params.userId ?? '', 10);
      if (Number.isNaN(targetUserId) || targetUserId <= 0) {
        res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'Invalid userId' });
        return;
      }

      const targetUser = await this.authService.getUserById(targetUserId);
      if (!targetUser) {
        res.status(HttpStatus.NOT_FOUND).json({ success: false, error: 'User not found' });
        return;
      }

      console.info(
        `[Admin Sync] Admin ${req.userId} triggering activity sync for user ${targetUserId}`
      );

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const sendEvent = (data: {
        type: 'fetching' | 'saving' | 'processing' | 'complete' | 'error';
        current?: number;
        total?: number;
        message?: string;
        challengesSynced?: number;
        challengeActivitiesAdded?: number;
      }): void => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const result = await this.activitiesService.syncActivitiesWithProgress(
          targetUser,
          sendEvent
        );
        sendEvent({
          type: 'complete',
          total: result.synced,
          message: `Synced ${result.synced} activities`,
          challengesSynced: result.challengesSynced,
          challengeActivitiesAdded: result.challengeActivitiesAdded,
        });
        res.end();
      } catch (error) {
        console.error(
          `[Admin Sync] Error syncing activities for user ${targetUserId}:`,
          error instanceof Error ? error.message : error
        );
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

  processUserBacklogStream = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const targetUserId = parseInt(req.params.userId ?? '', 10);
      if (Number.isNaN(targetUserId) || targetUserId <= 0) {
        res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'Invalid userId' });
        return;
      }

      const targetUser = await this.authService.getUserById(targetUserId);
      if (!targetUser) {
        res.status(HttpStatus.NOT_FOUND).json({ success: false, error: 'User not found' });
        return;
      }

      console.info(
        `[Admin Backlog] Admin ${req.userId} processing PR backlog for user ${targetUserId}`
      );

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const send = (event: BacklogProgressEvent): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        await this.personalRecordsService.processBacklogWithProgress(targetUser, send);
        res.end();
      } catch (error) {
        console.error(
          `[Admin Backlog] Error processing backlog for user ${targetUserId}:`,
          error instanceof Error ? error.message : error
        );
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Processing failed',
        });
        res.end();
      }
    } catch (error) {
      next(error);
    }
  };
}

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AdminQuotaService } from './admin-quota.service.js';
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
}

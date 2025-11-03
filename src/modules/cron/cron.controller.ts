import type { Request, Response } from 'express';
import { CronService } from './cron.service.js';
import { config } from '@config/env.js';

export class CronController {
  private cronService: CronService;

  constructor() {
    this.cronService = new CronService();
  }

  /**
   * POST /api/cron/check-challenges
   * Check and update challenges that have reached their deadline
   * Called by Vercel Cron
   */
  checkChallenges = async (req: Request, res: Response): Promise<void> => {
    try {
      // Verify cron authorization
      if (!this.verifyCronAuth(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      console.info('[Cron] Checking challenge deadlines...');

      const result = await this.cronService.checkChallengeDeadlines();

      console.info(
        `[Cron] Processed ${result.processed} challenges: ${result.completed} completed, ${result.failed} failed`
      );

      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[Cron Controller] Check challenges error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * POST /api/cron/cleanup
   * Clean up old events and expired tokens
   * Called by Vercel Cron
   */
  cleanup = async (req: Request, res: Response): Promise<void> => {
    try {
      // Verify cron authorization
      if (!this.verifyCronAuth(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      console.info('[Cron] Running cleanup...');

      const [eventsDeleted, tokensDeleted] = await Promise.all([
        this.cronService.cleanupOldEvents(),
        this.cronService.cleanupExpiredTokens(),
      ]);

      console.info(`[Cron] Cleanup complete: ${eventsDeleted} events, ${tokensDeleted} tokens`);

      res.status(200).json({
        success: true,
        eventsDeleted,
        tokensDeleted,
      });
    } catch (error) {
      console.error('[Cron Controller] Cleanup error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Verify cron request is authorized
   * Uses Vercel Cron Secret or authorization header
   */
  private verifyCronAuth(req: Request): boolean {
    // In development, allow all requests
    if (config.nodeEnv === 'development') {
      return true;
    }

    // Vercel Cron sends authorization header with secret
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return false;
    }

    // Expected format: "Bearer <secret>"
    const secret = authHeader.replace('Bearer ', '');
    const expectedSecret = process.env.CRON_SECRET || config.session.secret;

    return secret === expectedSecret;
  }
}

import type { Request, Response } from 'express';
import { PrivacyService } from './privacy.service.js';

function mapErrorStatus(message: string): number {
  if (message === 'User not found') {
    return 404;
  }
  if (message === 'Cannot block yourself' || message === 'Cannot mute yourself') {
    return 400;
  }
  if (message === 'User is already blocked') {
    return 409;
  }
  return 400;
}

export class PrivacyController {
  private privacyService = new PrivacyService();

  /**
   * POST /api/privacy/blocks/:userId — block a user.
   * Deletes any existing friendship/request and mute as a side effect.
   */
  block = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const targetId = Number(req.params.userId);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        res.status(400).json({ success: false, error: 'Invalid user id' });
        return;
      }
      await this.privacyService.block(userId, targetId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Privacy Controller] Block error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/privacy/blocks/:userId — unblock a user.
   */
  unblock = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const targetId = Number(req.params.userId);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        res.status(400).json({ success: false, error: 'Invalid user id' });
        return;
      }
      await this.privacyService.unblock(userId, targetId);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Privacy Controller] Unblock error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/privacy/mutes/:userId — mute a user.
   */
  mute = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const targetId = Number(req.params.userId);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        res.status(400).json({ success: false, error: 'Invalid user id' });
        return;
      }
      await this.privacyService.mute(userId, targetId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Privacy Controller] Mute error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/privacy/mutes/:userId — unmute a user.
   */
  unmute = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const targetId = Number(req.params.userId);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        res.status(400).json({ success: false, error: 'Invalid user id' });
        return;
      }
      await this.privacyService.unmute(userId, targetId);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Privacy Controller] Unmute error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/privacy/blocks — list users I've blocked.
   */
  listBlocked = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await this.privacyService.listBlocked(userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('[Privacy Controller] List blocked error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/privacy/mutes — list users I've muted.
   */
  listMuted = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await this.privacyService.listMuted(userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('[Privacy Controller] List muted error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

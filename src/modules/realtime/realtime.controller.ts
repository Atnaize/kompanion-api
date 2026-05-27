import type { Request, Response } from 'express';
import { realtimePublisher } from './realtime.publisher.js';
import { conversationsService } from '../chat/index.js';

export class RealtimeController {
  /**
   * Mint an Ably token for the viewer, scoped to the conversations they can
   * access right now. The browser calls this on connect and on token renewal.
   * Returns `{ enabled: false }` when realtime isn't configured so the client
   * can quietly stay on polling.
   */
  token = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      if (!realtimePublisher.enabled) {
        res.status(200).json({ success: true, data: { enabled: false } });
        return;
      }
      const conversationIds = await conversationsService.listConversationIds(userId);
      const tokenRequest = await realtimePublisher.createTokenRequest(userId, conversationIds);
      res.status(200).json({ success: true, data: { enabled: true, tokenRequest } });
    } catch (error) {
      console.error('[Realtime Controller] token error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

export const realtimeController = new RealtimeController();

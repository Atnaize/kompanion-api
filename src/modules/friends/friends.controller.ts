import type { Request, Response } from 'express';
import { FriendsService } from './friends.service.js';

function mapErrorStatus(message: string): number {
  if (message.startsWith('FORBIDDEN')) {
    return 403;
  }
  if (
    message === 'User not found' ||
    message.startsWith('No pending request') ||
    message === 'Not friends'
  ) {
    return 404;
  }
  if (message === 'Already friends') {
    return 409;
  }
  return 400;
}

export class FriendsController {
  private friendsService: FriendsService;

  constructor() {
    this.friendsService = new FriendsService();
  }

  /**
   * GET /api/friends/search?q=<query>
   * Search Kompanion users; each result is annotated with friendship state.
   */
  searchUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
        return;
      }
      const users = await this.friendsService.searchUsers(q, userId);
      res.status(200).json({ success: true, data: users });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Friends Controller] Search error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/friends — list of my accepted friends.
   */
  listFriends = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const friends = await this.friendsService.getFriends(userId);
      res.status(200).json({ success: true, data: friends });
    } catch (error) {
      console.error('[Friends Controller] List friends error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/friends/requests/incoming — pending requests sent to me.
   */
  listIncoming = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await this.friendsService.getIncomingRequests(userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('[Friends Controller] List incoming error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/friends/requests/outgoing — pending requests I sent.
   */
  listOutgoing = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await this.friendsService.getOutgoingRequests(userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('[Friends Controller] List outgoing error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/friends/requests/:userId — send a friend request to userId.
   * Idempotent: re-sending returns the existing PENDING row. If they already
   * sent me a request, this auto-accepts it.
   */
  sendRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const addresseeId = Number(req.params.userId);
      if (!Number.isInteger(addresseeId) || addresseeId <= 0) {
        res.status(400).json({ success: false, error: 'Invalid user id' });
        return;
      }
      const row = await this.friendsService.sendRequest(userId, addresseeId);
      res.status(200).json({ success: true, data: row });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Friends Controller] Send request error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/friends/requests/:userId/accept — accept the pending request from userId.
   */
  acceptRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const otherUserId = Number(req.params.userId);
      if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
        res.status(400).json({ success: false, error: 'Invalid user id' });
        return;
      }
      const row = await this.friendsService.acceptRequest(userId, otherUserId);
      res.status(200).json({ success: true, data: row });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Friends Controller] Accept error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/friends/requests/:userId — cancel my outgoing or decline incoming
   * request involving userId. Either direction deletes the PENDING row.
   */
  cancelOrDeclineRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const otherUserId = Number(req.params.userId);
      if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
        res.status(400).json({ success: false, error: 'Invalid user id' });
        return;
      }
      await this.friendsService.cancelOrDeclineRequest(userId, otherUserId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Friends Controller] Cancel/decline error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/friends/:userId — unfriend an accepted friend.
   */
  unfriend = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const otherUserId = Number(req.params.userId);
      if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
        res.status(400).json({ success: false, error: 'Invalid user id' });
        return;
      }
      await this.friendsService.unfriend(userId, otherUserId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Friends Controller] Unfriend error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

import type { Request, Response } from 'express';
import { InvitationService } from './invitation.service.js';
import { z } from 'zod';

const inviteUsersSchema = z.object({
  userIds: z.array(z.number()).min(1),
});

export class InvitationController {
  private invitationService: InvitationService;

  constructor() {
    this.invitationService = new InvitationService();
  }

  /**
   * POST /api/challenges/:id/invite
   * Invite users to a challenge
   */
  inviteUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const validatedData = inviteUsersSchema.parse(req.body);

      await this.invitationService.inviteUsers(id, userId, validatedData.userIds);

      res.status(200).json({ success: true, message: 'Invitations sent successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
        return;
      }

      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      console.error('[Invitation Controller] Invite error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/challenges/:id/accept
   * Accept a challenge invitation
   */
  acceptInvitation = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const participant = await this.invitationService.acceptInvitation(id, userId);

      res.status(200).json({ success: true, data: participant });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      console.error('[Invitation Controller] Accept error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/challenges/:id/decline
   * Decline a challenge invitation
   */
  declineInvitation = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      await this.invitationService.declineInvitation(id, userId);

      res.status(200).json({ success: true, message: 'Invitation declined' });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      console.error('[Invitation Controller] Decline error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/challenges/:id/leave
   * Leave a challenge
   */
  leaveChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      await this.invitationService.leaveChallenge(id, userId);

      res.status(200).json({ success: true, message: 'Successfully left the challenge' });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      console.error('[Invitation Controller] Leave error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/challenges/invitations
   * Get pending invitations for authenticated user
   */
  getPendingInvitations = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const invitations = await this.invitationService.getPendingInvitations(userId);

      res.status(200).json({ success: true, data: invitations });
    } catch (error) {
      console.error('[Invitation Controller] Get invitations error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

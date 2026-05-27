import type { Request, Response } from 'express';
import { ClubsService } from './clubs.service.js';

interface CreateClubBody {
  name?: unknown;
  description?: unknown;
  visibility?: unknown;
  invitedUserIds?: unknown;
}

interface UpdateClubBody {
  name?: unknown;
  description?: unknown;
  visibility?: unknown;
  accentColor?: unknown;
}

interface InviteBody {
  userIds?: unknown;
}

interface SetRoleBody {
  role?: unknown;
}

function mapErrorStatus(message: string): number {
  if (message.startsWith('FORBIDDEN')) {
    return 403;
  }
  if (
    message === 'Club not found' ||
    message === 'No pending invite' ||
    message === 'Not a member of this club'
  ) {
    return 404;
  }
  if (
    message === 'Club name must be 2–60 characters' ||
    message === 'Invalid visibility' ||
    message === 'Only friends can be added to a challenge' || // reused friend assertion
    message === 'Owner cannot leave; transfer ownership first'
  ) {
    return 400;
  }
  return 400;
}

export class ClubsController {
  private clubsService = new ClubsService();

  /**
   * POST /api/clubs — create a new club.
   * Body: { name, description?, visibility?, invitedUserIds? }
   */
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = (req.body ?? {}) as CreateClubBody;
      const name = body.name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ success: false, error: 'name is required' });
        return;
      }
      const description = typeof body.description === 'string' ? body.description : undefined;
      const visibility =
        body.visibility === 'private' || body.visibility === 'public' ? body.visibility : undefined;
      const invitedUserIds = Array.isArray(body.invitedUserIds)
        ? body.invitedUserIds.filter((id: unknown): id is number => Number.isInteger(id))
        : undefined;
      const data = await this.clubsService.createClub(userId, {
        name,
        description,
        visibility,
        invitedUserIds,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Create error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/clubs — clubs I'm an active member of.
   */
  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await this.clubsService.listMyClubs(userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('[Clubs Controller] List error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/clubs/invites — pending club invites for me.
   */
  listInvites = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await this.clubsService.listMyInvites(userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('[Clubs Controller] List invites error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/clubs/:id — club detail (members + my role).
   */
  get = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await this.clubsService.getClubById(req.params.id, userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Get error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * PATCH /api/clubs/:id — update club metadata. Owner/admin only.
   */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = (req.body ?? {}) as UpdateClubBody;
      const name = typeof body.name === 'string' ? body.name : undefined;
      const description =
        body.description === null || typeof body.description === 'string'
          ? body.description
          : undefined;
      const visibility =
        body.visibility === 'private' || body.visibility === 'public' ? body.visibility : undefined;
      const accentColor =
        body.accentColor === null || typeof body.accentColor === 'string'
          ? (body.accentColor as Parameters<typeof this.clubsService.updateClub>[2]['accentColor'])
          : undefined;
      const data = await this.clubsService.updateClub(req.params.id, userId, {
        name,
        description,
        visibility,
        accentColor,
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Update error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/clubs/:id — delete the club. Owner only.
   */
  delete = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      await this.clubsService.deleteClub(req.params.id, userId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Delete error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/clubs/:id/invite — invite friends. Owner/admin only.
   * Body: { userIds: number[] }
   */
  invite = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = (req.body ?? {}) as InviteBody;
      if (!Array.isArray(body.userIds)) {
        res.status(400).json({ success: false, error: 'userIds must be an array' });
        return;
      }
      const ids = body.userIds.filter((id: unknown): id is number => Number.isInteger(id));
      await this.clubsService.invite(req.params.id, userId, ids);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Invite error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/clubs/:id/accept — accept my pending invite.
   */
  accept = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      await this.clubsService.acceptInvite(req.params.id, userId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Accept error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/clubs/:id/decline — decline my pending invite.
   */
  decline = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      await this.clubsService.declineInvite(req.params.id, userId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Decline error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/clubs/:id/leave — leave the club.
   */
  leave = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      await this.clubsService.leave(req.params.id, userId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Leave error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * PATCH /api/clubs/:id/members/:userId — change role. Owner only.
   * Body: { role: 'admin' | 'member' }
   */
  setMemberRole = async (req: Request, res: Response): Promise<void> => {
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
      const body = (req.body ?? {}) as SetRoleBody;
      if (body.role !== 'admin' && body.role !== 'member') {
        res.status(400).json({ success: false, error: 'Invalid role' });
        return;
      }
      await this.clubsService.setMemberRole(req.params.id, userId, targetId, body.role);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Set role error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/clubs/:id/members/:userId — kick a member. Admin/owner only;
   * only owner can kick admins.
   */
  kickMember = async (req: Request, res: Response): Promise<void> => {
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
      await this.clubsService.kickMember(req.params.id, userId, targetId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Kick error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/clubs/:id/transfer/:userId — transfer ownership. Owner only.
   * The previous owner becomes an admin.
   */
  transferOwnership = async (req: Request, res: Response): Promise<void> => {
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
      await this.clubsService.transferOwnership(req.params.id, userId, targetId);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
        return;
      }
      console.error('[Clubs Controller] Transfer ownership error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

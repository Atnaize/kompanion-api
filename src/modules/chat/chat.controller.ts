import type { Request, Response } from 'express';
import { chatService } from './chat.service.js';
import { conversationResolver } from './conversation.resolver.js';
import { conversationsService } from './conversations.service.js';

interface SendBody {
  body?: unknown;
  parentId?: unknown;
}

interface SetMuteBody {
  mutedUntil?: unknown;
}

interface ReactionBody {
  emoji?: unknown;
}

function mapErrorStatus(message: string): number {
  if (message.startsWith('FORBIDDEN')) return 403;
  if (message.endsWith('not found')) return 404;
  return 400;
}

function fail(res: Response, error: unknown, log: string): void {
  if (error instanceof Error) {
    res.status(mapErrorStatus(error.message)).json({ success: false, error: error.message });
    return;
  }
  console.error(log, error);
  res.status(500).json({ success: false, error: 'Internal server error' });
}

function parseLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('Invalid limit');
  }
  return n;
}

function parseUserId(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('userId must be a positive integer');
  }
  return n;
}

function parseUserIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error('userIds must be an array');
  }
  return value.map(parseUserId);
}

export class ChatController {
  // --- Conversation lookup (mounted under /api/challenges and /api/clubs) ---

  resolveChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const { summary } = await conversationResolver.resolveChallengeForViewer(
        req.params.id,
        userId
      );
      res.status(200).json({ success: true, data: summary });
    } catch (error) {
      fail(res, error, '[Chat Controller] resolveChallenge error:');
    }
  };

  resolveClub = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const { summary } = await conversationResolver.resolveClubForViewer(req.params.id, userId);
      res.status(200).json({ success: true, data: summary });
    } catch (error) {
      fail(res, error, '[Chat Controller] resolveClub error:');
    }
  };

  // --- DMs, groups & inbox (mounted under /api/conversations) ---

  /** Inbox: every conversation the viewer can see, newest first. */
  listConversations = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await conversationsService.listConversations(userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      fail(res, error, '[Chat Controller] listConversations error:');
    }
  };

  /** Total unread across all conversations — drives the nav badge. */
  unreadTotal = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const count = await conversationsService.unreadTotal(userId);
      res.status(200).json({ success: true, data: { count } });
    } catch (error) {
      fail(res, error, '[Chat Controller] unreadTotal error:');
    }
  };

  /** Get or create the 1:1 DM with a friend. Body: { userId }. */
  resolveDm = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const otherUserId = parseUserId((req.body ?? {}).userId);
      const { summary } = await conversationResolver.resolveDmForViewer(userId, otherUserId);
      res.status(200).json({ success: true, data: summary });
    } catch (error) {
      fail(res, error, '[Chat Controller] resolveDm error:');
    }
  };

  /** Resolve a conversation summary by id (for deep-links into a thread). */
  resolveById = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const { summary } = await conversationResolver.loadForViewer(req.params.id, userId);
      res.status(200).json({ success: true, data: summary });
    } catch (error) {
      fail(res, error, '[Chat Controller] resolveById error:');
    }
  };

  /** Create a group DM. Body: { userIds: number[], title?: string }. */
  createGroup = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = (req.body ?? {}) as { userIds?: unknown; title?: unknown };
      const userIds = parseUserIds(body.userIds);
      const title = typeof body.title === 'string' ? body.title : undefined;
      const summary = await conversationsService.createGroup(userId, userIds, title);
      res.status(201).json({ success: true, data: summary });
    } catch (error) {
      fail(res, error, '[Chat Controller] createGroup error:');
    }
  };

  /** Add members to a group DM. Body: { userIds: number[] }. */
  addParticipants = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userIds = parseUserIds((req.body ?? {}).userIds);
      await conversationsService.addParticipants(userId, req.params.id, userIds);
      res.status(200).json({ success: true });
    } catch (error) {
      fail(res, error, '[Chat Controller] addParticipants error:');
    }
  };

  /** Remove a member from a group DM (self = leave; others = owner-only). */
  removeParticipant = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const targetUserId = parseUserId(req.params.userId);
      await conversationsService.removeParticipant(userId, req.params.id, targetUserId);
      res.status(200).json({ success: true });
    } catch (error) {
      fail(res, error, '[Chat Controller] removeParticipant error:');
    }
  };

  /** Leave a group DM. */
  leave = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      await conversationsService.leave(userId, req.params.id);
      res.status(200).json({ success: true });
    } catch (error) {
      fail(res, error, '[Chat Controller] leave error:');
    }
  };

  // --- Messages ---

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const limit = parseLimit(req.query.limit);
      const data = await chatService.listMessages(req.params.id, userId, { cursor, limit });
      res.status(200).json({ success: true, data });
    } catch (error) {
      fail(res, error, '[Chat Controller] list error:');
    }
  };

  send = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = (req.body ?? {}) as SendBody;
      if (typeof body.body !== 'string') {
        res.status(400).json({ success: false, error: 'body must be a string' });
        return;
      }
      const parentId =
        body.parentId === undefined || body.parentId === null
          ? undefined
          : typeof body.parentId === 'string'
            ? body.parentId
            : null;
      if (parentId === null) {
        res.status(400).json({ success: false, error: 'parentId must be a string or null' });
        return;
      }
      const message = await chatService.sendMessage(req.params.id, userId, body.body, parentId);
      res.status(201).json({ success: true, data: message });
    } catch (error) {
      fail(res, error, '[Chat Controller] send error:');
    }
  };

  markRead = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      await chatService.markRead(req.params.id, userId);
      res.status(200).json({ success: true });
    } catch (error) {
      fail(res, error, '[Chat Controller] markRead error:');
    }
  };

  unreadCount = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const count = await chatService.unreadCount(req.params.id, userId);
      res.status(200).json({ success: true, data: { count } });
    } catch (error) {
      fail(res, error, '[Chat Controller] unreadCount error:');
    }
  };

  listReplies = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const limit = parseLimit(req.query.limit);
      const data = await chatService.listReplies(req.params.id, req.params.messageId, userId, {
        cursor,
        limit,
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      fail(res, error, '[Chat Controller] listReplies error:');
    }
  };

  // --- Mute ---

  getMute = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const data = await chatService.getMuteState(req.params.id, userId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      fail(res, error, '[Chat Controller] getMute error:');
    }
  };

  setMute = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = (req.body ?? {}) as SetMuteBody;
      let mutedUntil: Date | null;
      if (body.mutedUntil === null) {
        mutedUntil = null;
      } else if (typeof body.mutedUntil === 'string') {
        const parsed = new Date(body.mutedUntil);
        if (isNaN(parsed.getTime())) {
          res
            .status(400)
            .json({ success: false, error: 'Invalid mutedUntil (ISO date or null required)' });
          return;
        }
        mutedUntil = parsed;
      } else {
        res.status(400).json({ success: false, error: 'mutedUntil must be an ISO date or null' });
        return;
      }
      const data = await chatService.setMute(req.params.id, userId, mutedUntil);
      res.status(200).json({ success: true, data });
    } catch (error) {
      fail(res, error, '[Chat Controller] setMute error:');
    }
  };

  // --- Reactions ---

  addReaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const body = (req.body ?? {}) as ReactionBody;
      if (typeof body.emoji !== 'string') {
        res.status(400).json({ success: false, error: 'emoji must be a string' });
        return;
      }
      const reactions = await chatService.addReaction(
        req.params.id,
        req.params.messageId,
        userId,
        body.emoji
      );
      res.status(200).json({ success: true, data: { reactions } });
    } catch (error) {
      fail(res, error, '[Chat Controller] addReaction error:');
    }
  };

  removeReaction = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const reactions = await chatService.removeReaction(
        req.params.id,
        req.params.messageId,
        userId,
        decodeURIComponent(req.params.emoji)
      );
      res.status(200).json({ success: true, data: { reactions } });
    } catch (error) {
      fail(res, error, '[Chat Controller] removeReaction error:');
    }
  };
}

export const chatController = new ChatController();

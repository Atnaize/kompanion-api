import { Router } from 'express';
import { chatController } from './chat.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();

// Inbox + DM/group lifecycle. Literal single-segment paths registered before
// the `/:id/*` block so they're never shadowed by the param routes.
router.get('/', requireAuth, chatController.listConversations);
router.get('/unread-total', requireAuth, chatController.unreadTotal);
router.post('/dm', requireAuth, chatController.resolveDm);
router.post('/group', requireAuth, chatController.createGroup);

// Resolve a conversation summary by id. Single-segment, so it can't shadow the
// `/:id/*` routes below; registered after the literals above so it can't eat
// `/unread-total`.
router.get('/:id', requireAuth, chatController.resolveById);

// /api/conversations/:id/*. Conversation IDs are opaque UUIDs resolved from a
// scope endpoint (GET /api/challenges/:id/conversation, /api/clubs/:id/...) or
// from POST /dm | /group above.

// Group membership management (group DMs only).
router.post('/:id/participants', requireAuth, chatController.addParticipants);
router.delete('/:id/participants/:userId', requireAuth, chatController.removeParticipant);
router.post('/:id/leave', requireAuth, chatController.leave);

// Mute state — static path, must come before /messages routes.
router.get('/:id/mute', requireAuth, chatController.getMute);
router.patch('/:id/mute', requireAuth, chatController.setMute);

// Messages — list, send, mark read, unread count.
router.get('/:id/messages', requireAuth, chatController.list);
router.post('/:id/messages', requireAuth, chatController.send);
router.post('/:id/messages/read', requireAuth, chatController.markRead);
router.get('/:id/messages/unread-count', requireAuth, chatController.unreadCount);

// Replies + reactions are scoped under a specific message.
router.get('/:id/messages/:messageId/replies', requireAuth, chatController.listReplies);
router.post('/:id/messages/:messageId/reactions', requireAuth, chatController.addReaction);
router.delete(
  '/:id/messages/:messageId/reactions/:emoji',
  requireAuth,
  chatController.removeReaction
);

export default router;

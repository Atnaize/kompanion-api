import { Router } from 'express';
import { ClubsController } from './clubs.controller.js';
import { chatController } from '../chat/index.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const clubsController = new ClubsController();

// Order matters: static segments before :id param.
router.get('/invites', requireAuth, clubsController.listInvites);
router.get('/', requireAuth, clubsController.list);
router.post('/', requireAuth, clubsController.create);
router.get('/:id', requireAuth, clubsController.get);
router.patch('/:id', requireAuth, clubsController.update);
router.delete('/:id', requireAuth, clubsController.delete);
router.post('/:id/invite', requireAuth, clubsController.invite);
router.post('/:id/accept', requireAuth, clubsController.accept);
router.post('/:id/decline', requireAuth, clubsController.decline);
router.post('/:id/leave', requireAuth, clubsController.leave);
router.patch('/:id/members/:userId', requireAuth, clubsController.setMemberRole);
router.delete('/:id/members/:userId', requireAuth, clubsController.kickMember);
router.post('/:id/transfer/:userId', requireAuth, clubsController.transferOwnership);

// Chat lookup — same shape as the challenge resolver. Clients use the returned
// conversation id to drive /api/conversations/:id/* endpoints.
router.get('/:id/conversation', requireAuth, chatController.resolveClub);

export default router;

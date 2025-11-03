import { Router } from 'express';
import { ChallengeController } from './challenge.controller.js';
import { InvitationController } from './invitation.controller.js';
import { EventsController } from './events.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const challengeController = new ChallengeController();
const invitationController = new InvitationController();
const eventsController = new EventsController();

// Invitations (must come before /:id routes)
router.get('/invitations', requireAuth, invitationController.getPendingInvitations);

// Events (must come before /:id routes)
router.get('/events', requireAuth, eventsController.getUserChallengeEvents);

// Challenge CRUD
router.post('/', requireAuth, challengeController.createChallenge);
router.get('/', requireAuth, challengeController.getChallenges);
router.get('/:id', requireAuth, challengeController.getChallengeById);
router.patch('/:id', requireAuth, challengeController.updateChallenge);
router.delete('/:id', requireAuth, challengeController.deleteChallenge);

// Challenge actions
router.post('/:id/start', requireAuth, challengeController.startChallenge);
router.post('/:id/cancel', requireAuth, challengeController.cancelChallenge);

// Challenge progress
router.get('/:id/progress', requireAuth, challengeController.getChallengeProgress);

// Invitation actions
router.post('/:id/invite', requireAuth, invitationController.inviteUsers);
router.post('/:id/accept', requireAuth, invitationController.acceptInvitation);
router.post('/:id/decline', requireAuth, invitationController.declineInvitation);
router.post('/:id/leave', requireAuth, invitationController.leaveChallenge);

// Challenge events
router.get('/:id/events', requireAuth, eventsController.getChallengeEvents);

export default router;

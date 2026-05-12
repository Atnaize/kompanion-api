import { Router } from 'express';
import { FriendsController } from './friends.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const friendsController = new FriendsController();

// Order matters: static segments before :userId param.
router.get('/search', requireAuth, friendsController.searchUsers);
router.get('/requests/incoming', requireAuth, friendsController.listIncoming);
router.get('/requests/outgoing', requireAuth, friendsController.listOutgoing);
router.post('/requests/:userId/accept', requireAuth, friendsController.acceptRequest);
router.post('/requests/:userId', requireAuth, friendsController.sendRequest);
router.delete('/requests/:userId', requireAuth, friendsController.cancelOrDeclineRequest);
router.get('/', requireAuth, friendsController.listFriends);
router.delete('/:userId', requireAuth, friendsController.unfriend);

export default router;

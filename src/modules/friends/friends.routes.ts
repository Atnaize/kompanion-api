import { Router } from 'express';
import { FriendsController } from './friends.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const friendsController = new FriendsController();

router.get('/search', requireAuth, friendsController.searchUsers);

export default router;

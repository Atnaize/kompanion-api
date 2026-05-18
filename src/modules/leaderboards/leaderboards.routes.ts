import { Router } from 'express';
import { LeaderboardsController } from './leaderboards.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const leaderboardsController = new LeaderboardsController();

router.get('/friends', requireAuth, leaderboardsController.getFriendsLeaderboard);

export default router;

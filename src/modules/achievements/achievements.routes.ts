import { Router } from 'express';
import { AchievementsController } from './achievements.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const achievementsController = new AchievementsController();

router.get('/', requireAuth, achievementsController.list);
router.post('/:achievementId/redeem', requireAuth, achievementsController.redeem);

export default router;

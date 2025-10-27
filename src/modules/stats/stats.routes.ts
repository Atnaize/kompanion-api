import { Router } from 'express';
import { StatsController } from './stats.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const statsController = new StatsController();

router.get('/', requireAuth, statsController.getUserStats);

export default router;

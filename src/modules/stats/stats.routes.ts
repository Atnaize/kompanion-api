import { Router } from 'express';
import { StatsController } from './stats.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const statsController = new StatsController();

router.get('/', requireAuth, statsController.getUserStats);
router.get('/progress', requireAuth, statsController.getProgressData);
router.get('/compare', requireAuth, statsController.comparePeriods);
router.get('/compare-friend', requireAuth, statsController.compareWithFriend);
router.get('/compare-custom', requireAuth, statsController.compareCustomRanges);
router.get('/heatmap', requireAuth, statsController.getHeatmapData);

export default router;

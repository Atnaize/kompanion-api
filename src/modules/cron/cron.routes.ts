import { Router } from 'express';
import { CronController } from './cron.controller.js';

const router = Router();
const cronController = new CronController();

router.post('/check-challenges', cronController.checkChallenges);
router.post('/cleanup', cronController.cleanup);

export default router;

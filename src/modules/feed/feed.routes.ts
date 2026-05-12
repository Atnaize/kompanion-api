import { Router } from 'express';
import { FeedController } from './feed.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const feedController = new FeedController();

router.get('/', requireAuth, feedController.list);

export default router;

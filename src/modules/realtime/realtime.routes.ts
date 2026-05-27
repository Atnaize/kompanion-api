import { Router } from 'express';
import { realtimeController } from './realtime.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();

// Browser fetches a capability-scoped Ably token here (on connect + renewal).
router.post('/token', requireAuth, realtimeController.token);

export default router;

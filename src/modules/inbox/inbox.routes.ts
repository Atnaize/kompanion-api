import { Router } from 'express';
import { InboxController } from './inbox.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const controller = new InboxController();

// Static segments before :id param.
router.get('/count', requireAuth, controller.unreadCount);
router.post('/read-all', requireAuth, controller.markAllRead);
router.post('/:id/read', requireAuth, controller.markRead);
router.get('/', requireAuth, controller.list);

export default router;

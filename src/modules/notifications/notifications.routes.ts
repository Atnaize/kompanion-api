import { Router } from 'express';
import { NotificationsController } from './notifications.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const controller = new NotificationsController();

router.post('/subscribe', requireAuth, controller.subscribe);
router.post('/unsubscribe', requireAuth, controller.unsubscribe);
router.get('/preferences', requireAuth, controller.getPreferences);
router.put('/preferences', requireAuth, controller.updatePreferences);
router.get('/vapid-public-key', controller.getVapidPublicKey);
router.post('/test', requireAuth, controller.sendTestNotification);

export default router;

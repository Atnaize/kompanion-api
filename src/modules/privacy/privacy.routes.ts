import { Router } from 'express';
import { PrivacyController } from './privacy.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const privacyController = new PrivacyController();

// Order matters: static segments before :userId param.
router.get('/blocks', requireAuth, privacyController.listBlocked);
router.get('/mutes', requireAuth, privacyController.listMuted);
router.post('/blocks/:userId', requireAuth, privacyController.block);
router.delete('/blocks/:userId', requireAuth, privacyController.unblock);
router.post('/mutes/:userId', requireAuth, privacyController.mute);
router.delete('/mutes/:userId', requireAuth, privacyController.unmute);

export default router;

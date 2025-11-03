import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const authController = new AuthController();

router.get('/login', authController.login);
router.get('/callback', authController.callback);
router.get('/me', requireAuth, authController.me);
router.get('/debug', requireAuth, authController.debug);
router.post('/refresh', authController.refresh);
router.post('/refresh-strava', requireAuth, authController.forceRefreshStravaToken);
router.post('/logout', authController.logout);
router.delete('/account', requireAuth, authController.deleteAccount);

export default router;

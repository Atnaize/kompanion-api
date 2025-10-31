import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const authController = new AuthController();

router.get('/login', authController.login);
router.get('/callback', authController.callback);
router.get('/me', requireAuth, authController.me);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.delete('/account', requireAuth, authController.deleteAccount);

export default router;

import { Router } from 'express';
import { UsersController } from './users.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const usersController = new UsersController();

router.get('/:id/profile', requireAuth, usersController.getProfile);

export default router;

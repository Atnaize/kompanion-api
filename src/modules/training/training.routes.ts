import { Router } from 'express';
import { TrainingController } from './training.controller.js';
import { requireAuth, requireAdmin } from '@shared/middleware/index.js';

const router = Router();
const trainingController = new TrainingController();

// All training routes require authentication and admin access
router.get('/program', requireAuth, requireAdmin, trainingController.getProgram);
router.get('/week/:weekNumber', requireAuth, requireAdmin, trainingController.getWeek);
router.get('/current-week', requireAuth, requireAdmin, trainingController.getCurrentWeek);

export default router;

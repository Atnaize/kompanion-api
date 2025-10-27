import { Router } from 'express';
import { ActivitiesController } from './activities.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const activitiesController = new ActivitiesController();

router.get('/', requireAuth, activitiesController.list);
router.post('/sync', requireAuth, activitiesController.sync);
router.get('/sync/stream', requireAuth, activitiesController.syncWithProgress);
router.get('/:id', requireAuth, activitiesController.getById);

export default router;

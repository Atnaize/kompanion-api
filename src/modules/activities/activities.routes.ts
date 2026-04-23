import { Router } from 'express';
import { ActivitiesController } from './activities.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const activitiesController = new ActivitiesController();

router.get('/', requireAuth, activitiesController.list);
router.post('/sync', requireAuth, activitiesController.sync);
router.get('/sync/stream', requireAuth, activitiesController.syncWithProgress);

// Test endpoints (must come before /:id)
router.post('/test/delete', requireAuth, activitiesController.deleteActivitiesForTest);

router.get('/:id', requireAuth, activitiesController.getById);
router.get('/:id/streams', requireAuth, activitiesController.getStreams);
router.get('/:id/laps', requireAuth, activitiesController.getLaps);
router.get('/:id/kudoers', requireAuth, activitiesController.getKudoers);
router.get('/:id/comments', requireAuth, activitiesController.getComments);
router.get('/:id/photos', requireAuth, activitiesController.getPhotos);

export default router;

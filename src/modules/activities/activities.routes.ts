import { Router } from 'express';
import { ActivitiesController } from './activities.controller.js';
import { requireAuth, requireUser } from '@shared/middleware/index.js';

const router = Router();
const activitiesController = new ActivitiesController();

// Every route here needs the DB user record. Apply both middlewares once.
router.use(requireAuth, requireUser);

router.get('/', activitiesController.list);
router.post('/sync', activitiesController.sync);
router.get('/sync/stream', activitiesController.syncWithProgress);

// Test endpoints (must come before /:id)
router.post('/test/delete', activitiesController.deleteActivitiesForTest);

router.get('/:id', activitiesController.getById);
router.get('/:id/streams', activitiesController.getStreams);
router.get('/:id/laps', activitiesController.getLaps);
router.get('/:id/kudoers', activitiesController.getKudoers);
router.get('/:id/comments', activitiesController.getComments);
router.get('/:id/photos', activitiesController.getPhotos);

export default router;

import { Router } from 'express';
import { PersonalRecordsController } from './personal-records.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const personalRecordsController = new PersonalRecordsController();

router.get('/', requireAuth, personalRecordsController.list);

export default router;

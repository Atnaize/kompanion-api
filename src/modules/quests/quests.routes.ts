import { Router } from 'express';
import { QuestsController } from './quests.controller.js';
import { requireAuth } from '@shared/middleware/index.js';

const router = Router();
const questsController = new QuestsController();

router.get('/', requireAuth, questsController.list);

export default router;

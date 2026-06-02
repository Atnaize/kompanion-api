import { Router } from 'express';
import { PublicController } from './public.controller.js';

const router = Router();
const publicController = new PublicController();

router.get('/stats', publicController.getStats);

export default router;

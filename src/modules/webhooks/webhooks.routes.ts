import { Router } from 'express';
import { WebhooksController } from './webhooks.controller.js';

const router = Router();
const webhooksController = new WebhooksController();

// Strava webhook endpoints
// GET for validation (called once by Strava to verify callback URL)
router.get('/strava', webhooksController.validateStravaWebhook);

// POST for events (called by Strava when activities are created/updated/deleted)
router.post('/strava', webhooksController.handleStravaWebhook);

export default router;

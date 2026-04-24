import { Router } from 'express';
import { requireAdmin, requireAuth } from '@shared/middleware/index.js';
import { WebhooksController } from './webhooks.controller.js';

const controller = new WebhooksController();

/**
 * Public webhook receiver. No auth — Strava POSTs here directly. Mounted at
 * `/api/webhooks` from server.ts.
 */
export const webhooksPublicRoutes = Router();
webhooksPublicRoutes.get('/strava', controller.handshake);
webhooksPublicRoutes.post('/strava', controller.receive);

/**
 * Admin endpoints. Require auth + admin role. Mounted at
 * `/api/admin/webhooks` from server.ts.
 */
export const webhooksAdminRoutes = Router();
webhooksAdminRoutes.use(requireAuth, requireAdmin);
webhooksAdminRoutes.get('/diagnostics', controller.diagnostics);
webhooksAdminRoutes.get('/status', controller.status);
webhooksAdminRoutes.post('/subscribe', controller.subscribe);
webhooksAdminRoutes.delete('/subscribe/:stravaId', controller.unsubscribe);
webhooksAdminRoutes.get('/events', controller.listEvents);
webhooksAdminRoutes.get('/events/:id', controller.getEvent);
webhooksAdminRoutes.post('/events/:id/retry', controller.retryEvent);
webhooksAdminRoutes.post('/simulate', controller.simulate);

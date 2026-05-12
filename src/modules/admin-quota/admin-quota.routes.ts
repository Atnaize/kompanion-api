import { Router } from 'express';
import { requireAdmin, requireAuth } from '@shared/middleware/index.js';
import { AdminQuotaController } from './admin-quota.controller.js';

const controller = new AdminQuotaController();

export const adminQuotaRoutes = Router();
adminQuotaRoutes.use(requireAuth, requireAdmin);

adminQuotaRoutes.get('/overview', controller.overview);
adminQuotaRoutes.get('/users', controller.users);
adminQuotaRoutes.get('/backlog', controller.backlog);
adminQuotaRoutes.get('/grants', controller.listGrants);
adminQuotaRoutes.post('/grants', controller.createGrant);
adminQuotaRoutes.delete('/grants/:id', controller.revokeGrant);

// Run on behalf of another user. SSE streams; quota is charged to the target user.
adminQuotaRoutes.get('/users/:userId/sync-activities/stream', controller.syncUserActivitiesStream);
adminQuotaRoutes.get('/users/:userId/process-backlog/stream', controller.processUserBacklogStream);

export default adminQuotaRoutes;

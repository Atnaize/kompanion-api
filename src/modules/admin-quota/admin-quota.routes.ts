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

export default adminQuotaRoutes;

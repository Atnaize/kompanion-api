import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { errorHandler } from './shared/middleware/index.js';
import { authRoutes } from './modules/auth/index.js';
import { activitiesRoutes } from './modules/activities/index.js';
import { statsRoutes } from './modules/stats/index.js';
import { achievementsRoutes } from './modules/achievements/index.js';
import { challengeRoutes } from './modules/challenges/index.js';
import { friendsRoutes } from './modules/friends/index.js';
import { usersRoutes } from './modules/users/index.js';
import { feedRoutes } from './modules/feed/index.js';
import { inboxRoutes } from './modules/inbox/index.js';
import { notificationsRoutes } from './modules/notifications/index.js';
import { personalRecordsRoutes } from './modules/personal-records/index.js';
import { webhooksAdminRoutes, webhooksPublicRoutes } from './modules/webhooks/index.js';
import { adminQuotaRoutes } from './modules/admin-quota/index.js';
import { apiReference } from '@scalar/express-api-reference';
import { getOpenApiDocument } from './shared/openapi/document.js';

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      console.info(`📡 CORS check for origin: ${origin || 'no-origin'}`);
      console.info(`🔐 Allowed origins: ${config.allowedOrigins.join(', ')}`);

      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) {
        console.info('✅ Allowing request with no origin');
        return callback(null, true);
      }

      if (config.allowedOrigins.includes(origin)) {
        console.info(`✅ Origin ${origin} is allowed`);
        callback(null, true);
      } else {
        console.info(`❌ Origin ${origin} is NOT allowed`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/openapi.json', (_req, res) => {
  res.json(getOpenApiDocument());
});

app.get(
  '/',
  apiReference({
    url: '/openapi.json',
    theme: 'purple',
    layout: 'modern',
    pageTitle: 'Kompanion API — Reference',
    metaData: { title: 'Kompanion API — Reference' },
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/debug/config', (_req, res) => {
  res.json({
    nodeEnv: config.nodeEnv,
    allowedOrigins: config.allowedOrigins,
    isVercel: !!process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV || 'not-vercel',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/achievements', achievementsRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/personal-records', personalRecordsRoutes);
app.use('/api/webhooks', webhooksPublicRoutes);
app.use('/api/admin/webhooks', webhooksAdminRoutes);
app.use('/api/admin/quota', adminQuotaRoutes);

app.use(errorHandler);

// Export the app for Vercel serverless
export default app;

// Only listen on port if not in serverless environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(config.port, () => {
    console.info(`🚀 Kompanion API running on http://localhost:${config.port}`);
    console.info(`📚 API reference: http://localhost:${config.port}/`);
    console.info(`📝 Environment: ${config.nodeEnv}`);
    console.info(`🌐 Allowed origins: ${config.allowedOrigins.join(', ')}`);
  });
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env.js';
import { errorHandler } from './shared/middleware/index.js';
import { logger, httpLogger } from './shared/logger/index.js';
import { globalLimiter, authLimiter, syncLimiter } from './shared/security/index.js';
import { authRoutes } from './modules/auth/index.js';
import { activitiesRoutes } from './modules/activities/index.js';
import { statsRoutes } from './modules/stats/index.js';
import { achievementsRoutes } from './modules/achievements/index.js';
import { challengeRoutes } from './modules/challenges/index.js';
import { friendsRoutes } from './modules/friends/index.js';
import { usersRoutes } from './modules/users/index.js';
import { feedRoutes } from './modules/feed/index.js';
import { leaderboardsRoutes } from './modules/leaderboards/index.js';
import { inboxRoutes } from './modules/inbox/index.js';
import { notificationsRoutes } from './modules/notifications/index.js';
import { personalRecordsRoutes } from './modules/personal-records/index.js';
import { webhooksAdminRoutes, webhooksPublicRoutes } from './modules/webhooks/index.js';
import { adminQuotaRoutes } from './modules/admin-quota/index.js';
import { privacyRoutes } from './modules/privacy/index.js';
import { apiReference } from '@scalar/express-api-reference';
import { getOpenApiDocument } from './shared/openapi/document.js';

const app = express();

// Trust Vercel's edge proxy so req.ip is the real client (otherwise the
// rate limiter would see a single upstream IP for everyone). Single hop only.
app.set('trust proxy', 1);

app.use(httpLogger);

// helmet — sane security headers. CSP is off because the Scalar docs page
// serves an inline page from a third-party CDN; turn back on once we serve
// the reference behind our own bundle.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, mobile apps, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      if (config.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn({ origin }, 'CORS rejected');
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Capture the raw request body so QStash signature verification can hash it.
// 1mb is generous for webhook payloads; bumps real-world abuse floor.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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

// Global throttle on /api/* — generous floor against runaway loops.
app.use('/api', globalLimiter);

// Tighter limiters on hot paths.
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/activities/sync', syncLimiter);

app.use('/api/activities', activitiesRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/achievements', achievementsRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/leaderboards', leaderboardsRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/personal-records', personalRecordsRoutes);
app.use('/api/privacy', privacyRoutes);
app.use('/api/webhooks', webhooksPublicRoutes);
app.use('/api/admin/webhooks', webhooksAdminRoutes);
app.use('/api/admin/quota', adminQuotaRoutes);

app.use(errorHandler);

// Export the app for Vercel serverless
export default app;

// Only listen on port if not in serverless environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.nodeEnv,
        allowedOrigins: config.allowedOrigins,
      },
      `🚀 Kompanion API listening on http://localhost:${config.port}`
    );
  });
}

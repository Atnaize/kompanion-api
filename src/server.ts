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
import { notificationsRoutes } from './modules/notifications/index.js';
import trainingRoutes from './modules/training/training.routes.js';

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
app.use('/api/notifications', notificationsRoutes);
app.use('/api/training', trainingRoutes);

app.use(errorHandler);

// Export the app for Vercel serverless
export default app;

// Only listen on port if not in serverless environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(config.port, () => {
    console.info(`🚀 Kompanion API running on http://localhost:${config.port}`);
    console.info(`📝 Environment: ${config.nodeEnv}`);
    console.info(`🌐 Allowed origins: ${config.allowedOrigins.join(', ')}`);
  });
}

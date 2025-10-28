import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/env.js';
import { errorHandler } from './shared/middleware/index.js';
import { authRoutes } from './modules/auth/index.js';
import { activitiesRoutes } from './modules/activities/index.js';
import { statsRoutes } from './modules/stats/index.js';
import { achievementsRoutes } from './modules/achievements/index.js';
import { questsRoutes } from './modules/quests/index.js';

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      console.log(`📡 CORS check for origin: ${origin || 'no-origin'}`);
      console.log(`🔐 Allowed origins: ${config.allowedOrigins.join(', ')}`);

      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) {
        console.log('✅ Allowing request with no origin');
        return callback(null, true);
      }

      if (config.allowedOrigins.includes(origin)) {
        console.log(`✅ Origin ${origin} is allowed`);
        callback(null, true);
      } else {
        console.log(`❌ Origin ${origin} is NOT allowed`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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
app.use('/api/quests', questsRoutes);

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

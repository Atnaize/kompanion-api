import express from 'express';
import cors from 'cors';
import session from 'express-session';
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
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (config.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.nodeEnv === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    },
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/achievements', achievementsRoutes);
app.use('/api/quests', questsRoutes);

app.use(errorHandler);

app.listen(config.port, () => {
  console.info(`🚀 Kompanion API running on http://localhost:${config.port}`);
  console.info(`📝 Environment: ${config.nodeEnv}`);
  console.info(`🌐 Allowed origins: ${config.allowedOrigins.join(', ')}`);
});

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

dotenvConfig();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  STRAVA_CLIENT_ID: z.string().min(1, 'STRAVA_CLIENT_ID is required'),
  STRAVA_CLIENT_SECRET: z.string().min(1, 'STRAVA_CLIENT_SECRET is required'),
  STRAVA_REDIRECT_URI: z.string().url(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  VAPID_PUBLIC_KEY: z.string().min(1, 'VAPID_PUBLIC_KEY is required'),
  VAPID_PRIVATE_KEY: z.string().min(1, 'VAPID_PRIVATE_KEY is required'),
  VAPID_SUBJECT: z.string().min(1, 'VAPID_SUBJECT is required (mailto:email or https://domain)'),

  // Personal-records quota knobs. Strava allows 200 req / 15min and 2000 req /
  // day per app. Webhook fetches + activity-list syncs share the same budget,
  // so we keep ~500/day in reserve and let PR backfill use the remaining 1500.
  PR_DAILY_USER_CAP: z.coerce.number().int().positive().default(100),
  PR_DAILY_APP_BUDGET: z.coerce.number().int().positive().default(1500),
  // Delay between per-activity Strava calls during PR backfill. 500ms ≈ 120
  // req/min — Strava's 15-min window (200 req) bites first, so this is more
  // politeness than throttle.
  PR_PROCESSING_DELAY_MS: z.coerce.number().int().min(0).default(500),

  // QStash (Upstash) decouples webhook ack from processing. The receive
  // handler publishes a message and returns 200 instantly; QStash POSTs the
  // worker URL with retries and DLQ. All four are required — we fail loudly
  // at startup rather than silently fall back to synchronous processing.
  QSTASH_TOKEN: z.string().min(1, 'QSTASH_TOKEN is required'),
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1, 'QSTASH_CURRENT_SIGNING_KEY is required'),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1, 'QSTASH_NEXT_SIGNING_KEY is required'),
  WEBHOOK_WORKER_URL: z.string().url('WEBHOOK_WORKER_URL must be an absolute URL'),

  // Pagination: hard ceiling enforced by validatePagination. Adjustable per
  // env for endpoints that need wider page sizes (e.g. /feed during backfill).
  PAGINATION_MAX_LIMIT: z.coerce.number().int().positive().default(100),
  PAGINATION_DEFAULT_LIMIT: z.coerce.number().int().positive().default(20),

  // Realtime chat (Ably). Optional: when unset, publishing is a no-op and the
  // client falls back to polling. The browser never sees this key — it mints
  // short-lived, capability-scoped tokens via POST /api/realtime/token.
  ABLY_API_KEY: z.string().min(1).optional(),

  // Owner whose stats are exposed (no auth) via GET /api/public/stats — powers
  // the public portfolio site. When unset we fall back to the first admin user.
  PUBLIC_STATS_USER_ID: z.coerce.number().int().positive().optional(),
});

const parseEnv = (): z.infer<typeof envSchema> => {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }

  return parsed.data;
};

export const env = parseEnv();

const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim());

export const config = {
  port: parseInt(env.PORT, 10),
  nodeEnv: env.NODE_ENV,
  allowedOrigins,
  strava: {
    clientId: env.STRAVA_CLIENT_ID,
    clientSecret: env.STRAVA_CLIENT_SECRET,
    redirectUri: env.STRAVA_REDIRECT_URI,
    authUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
    apiUrl: 'https://www.strava.com/api/v3',
  },
  session: {
    secret: env.SESSION_SECRET,
  },
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  },
  personalRecords: {
    dailyUserCap: env.PR_DAILY_USER_CAP,
    dailyAppBudget: env.PR_DAILY_APP_BUDGET,
    processingDelayMs: env.PR_PROCESSING_DELAY_MS,
  },
  qstash: {
    token: env.QSTASH_TOKEN,
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
    workerUrl: env.WEBHOOK_WORKER_URL,
  },
  pagination: {
    maxLimit: env.PAGINATION_MAX_LIMIT,
    defaultLimit: env.PAGINATION_DEFAULT_LIMIT,
  },
  realtime: {
    ablyApiKey: env.ABLY_API_KEY ?? null,
    enabled: !!env.ABLY_API_KEY,
  },
  publicStats: {
    userId: env.PUBLIC_STATS_USER_ID ?? null,
  },
} as const;

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
} as const;

import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { logger } from '../logger/index.js';

// Vercel runs each cold instance independently, so this is best-effort
// per-instance throttling — sufficient for casual abuse / accidental loops,
// not a substitute for an edge / Upstash-backed limiter.
const makeLimiter = (
  partial: Partial<Options> & Pick<Options, 'windowMs' | 'limit'>
): ReturnType<typeof rateLimit> =>
  rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req: Request, res: Response): void => {
      logger.warn({ reqId: req.id, ip: req.ip, path: req.path }, 'Rate limit exceeded');
      res.status(429).json({ success: false, error: 'Too many requests' });
    },
    ...partial,
  });

// Global default — generous, intended to swat runaway loops.
export const globalLimiter = makeLimiter({
  windowMs: 60_000,
  limit: 300,
});

// Auth endpoints — tighter because they touch Strava OAuth + JWT issuance.
export const authLimiter = makeLimiter({
  windowMs: 60_000,
  limit: 20,
});

// Sync endpoints hit Strava and burn API quota; one per few seconds is fine.
export const syncLimiter = makeLimiter({
  windowMs: 60_000,
  limit: 10,
});

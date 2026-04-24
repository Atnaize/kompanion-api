import axios, { type AxiosResponse } from 'axios';
import { AppError } from '@shared/middleware/index.js';
import { HttpStatus } from '@shared/types/index.js';

/**
 * Strava returns `X-RateLimit-Usage: used15min,usedDay` and
 * `X-RateLimit-Limit: limit15min,limitDay` on every response. The 15-min
 * window resets at :00/:15/:30/:45 of each hour; the daily window resets at
 * midnight UTC.
 */
export interface StravaRateLimitUsage {
  used15min: number;
  limit15min: number;
  usedDay: number;
  limitDay: number;
}

export class StravaRateLimitError extends AppError {
  constructor(
    public readonly resetInMinutes: number,
    public readonly usage: StravaRateLimitUsage | null
  ) {
    const resetAt = new Date(Date.now() + resetInMinutes * 60_000);
    const hh = resetAt.getUTCHours().toString().padStart(2, '0');
    const mm = resetAt.getUTCMinutes().toString().padStart(2, '0');
    const usageText = usage ? ` (${usage.used15min}/${usage.limit15min} used this window)` : '';
    super(
      HttpStatus.TOO_MANY_REQUESTS,
      `Strava rate limit reached${usageText}. Try again at ${hh}:${mm} UTC (in ~${resetInMinutes} min).`
    );
  }
}

const parsePair = (raw: string | undefined): [number, number] | null => {
  if (!raw) return null;
  const parts = raw.split(',').map((n) => parseInt(n.trim(), 10));
  if (parts.length !== 2 || parts.some(isNaN)) return null;
  return [parts[0], parts[1]];
};

export const parseRateLimitHeaders = (
  headers: Record<string, string | undefined> | AxiosResponse['headers']
): StravaRateLimitUsage | null => {
  const get = (key: string): string | undefined => {
    const value =
      (headers as Record<string, unknown>)[key] ??
      (headers as Record<string, unknown>)[key.toLowerCase()];
    return typeof value === 'string' ? value : undefined;
  };

  const usage = parsePair(get('x-ratelimit-usage'));
  const limit = parsePair(get('x-ratelimit-limit'));

  if (!usage || !limit) return null;

  return {
    used15min: usage[0],
    usedDay: usage[1],
    limit15min: limit[0],
    limitDay: limit[1],
  };
};

// Minutes until the next :00/:15/:30/:45 boundary (UTC).
export const minutesUntilNextFifteenMinuteBoundary = (now = new Date()): number => {
  const m = now.getUTCMinutes();
  const s = now.getUTCSeconds();
  const minutesIntoWindow = m % 15;
  const remaining = 15 - minutesIntoWindow - (s > 0 ? 0 : 0);
  return Math.max(1, remaining);
};

/**
 * Inspect an axios error and, if it's a Strava 429, throw a typed
 * `StravaRateLimitError` with a readable message. Otherwise re-throw.
 */
export const throwIfRateLimited = (error: unknown): void => {
  if (!axios.isAxiosError(error) || error.response?.status !== 429) return;

  const usage = parseRateLimitHeaders(error.response.headers);
  const resetIn = minutesUntilNextFifteenMinuteBoundary();
  throw new StravaRateLimitError(resetIn, usage);
};

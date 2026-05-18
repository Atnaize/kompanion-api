import { prisma } from './prisma.js';
import { logger } from '../logger/index.js';

// Cross-process debounce via a Postgres-level atomic guard.
//
// `tryClaimRun` returns true to exactly one caller per (job, interval window).
// The trick is a conditional updateMany — Postgres serializes UPDATE locks,
// so the first transaction to satisfy `lastRunAt < cutoff` flips the row and
// every later contender sees `count === 0`.
//
// On first ever call the row doesn't exist; we insert it via `create` inside
// a unique-violation catch (cheap because misses are rare). We deliberately
// do NOT use `upsert` because that would overwrite the timestamp on every
// call regardless of the cutoff condition.
export async function tryClaimRun(jobName: string, intervalMs: number): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - intervalMs);

  const updated = await prisma.scheduledJobRun.updateMany({
    where: { name: jobName, lastRunAt: { lt: cutoff } },
    data: { lastRunAt: now },
  });

  if (updated.count === 1) return true;
  if (updated.count > 0) {
    // Should be unreachable since name is @id.
    logger.warn({ jobName, count: updated.count }, 'tryClaimRun matched >1 row');
    return true;
  }

  // Row might not exist yet — try to create. On unique-violation we lost.
  try {
    await prisma.scheduledJobRun.create({
      data: { name: jobName, lastRunAt: now },
    });
    return true;
  } catch {
    return false;
  }
}

// `result` is freeform on purpose — callers pass `'ok'` / `'error'` today
// but new sweeps may emit richer summaries (e.g. `'ok:0-rows'`).
export async function recordRunResult(jobName: string, result: string): Promise<void> {
  try {
    await prisma.scheduledJobRun.update({
      where: { name: jobName },
      data: { lastResult: result },
    });
  } catch (err) {
    logger.warn({ jobName, err }, 'recordRunResult failed');
  }
}

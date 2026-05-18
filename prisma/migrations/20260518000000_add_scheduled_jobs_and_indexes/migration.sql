-- Cross-process debounce / lease table for background jobs (e.g. the lazy
-- `complete_expired_challenges` sweep). Replaces a module-scoped Date.now()
-- guard that doesn't survive serverless cold starts.
CREATE TABLE "scheduled_job_runs" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastResult" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("name")
);

-- Composite index for "all activities of type T for user U" — used by
-- retroactive challenge backfill and per-sport stat queries. The existing
-- (userId) and (type) singletons couldn't be combined cheaply for both
-- predicates.
CREATE INDEX "activities_userId_type_idx" ON "activities"("userId", "type");

-- Type-filtered feed queries (admin dashboards, per-type backfills). The
-- existing (createdAt) index alone scans the whole window; this lets PG hit
-- the partition for the requested event type directly.
CREATE INDEX "feed_events_type_createdAt_idx" ON "feed_events"("type", "createdAt");

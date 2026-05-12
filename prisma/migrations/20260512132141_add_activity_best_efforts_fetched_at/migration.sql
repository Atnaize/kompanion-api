-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "bestEffortsFetchedAt" TIMESTAMP(3);

-- Backfill: every activity that already has at least one PersonalRecord row
-- has clearly been fetched once, so mark it processed. Without this, every
-- existing user would see their entire history flagged "unprocessed" on next
-- PR page visit and we'd re-spend Strava budget refetching everything.
UPDATE "activities" a
SET "bestEffortsFetchedAt" = NOW()
WHERE "bestEffortsFetchedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "personal_records" pr WHERE pr."activityId" = a.id
  );

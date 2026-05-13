-- Drop the dead `challengeReminders` column (no code path gated on it after
-- unifying all challenge notifications through the inbox emitter).
ALTER TABLE "notification_preferences" DROP COLUMN "challengeReminders";

-- Rename `challengeProgress` to `challengeUpdates` since it now covers
-- joins, milestones, activity updates, cancellations, and completions —
-- not just "progress". Existing user opt-outs are preserved by the rename.
ALTER TABLE "notification_preferences" RENAME COLUMN "challengeProgress" TO "challengeUpdates";

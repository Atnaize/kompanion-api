-- Drop the old unique constraint
ALTER TABLE "user_quests" DROP CONSTRAINT IF EXISTS "user_quests_userId_questId_key";

-- Add the new unique constraint that includes startedAt
-- This allows users to have multiple quest instances (one per week)
ALTER TABLE "user_quests" ADD CONSTRAINT "user_quests_userId_questId_startedAt_key" UNIQUE ("userId", "questId", "startedAt");

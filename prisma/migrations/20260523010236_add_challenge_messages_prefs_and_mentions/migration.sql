-- AlterTable
ALTER TABLE "notification_preferences"
  ADD COLUMN "challengeMessages" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "challengeMentions" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "challenge_messages" ADD COLUMN "mentions" JSONB;

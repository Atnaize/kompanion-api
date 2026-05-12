-- AlterTable
ALTER TABLE "notification_preferences"
  ADD COLUMN "friendRequests" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "friendAccepted" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "achievementUnlocked" BOOLEAN NOT NULL DEFAULT true;

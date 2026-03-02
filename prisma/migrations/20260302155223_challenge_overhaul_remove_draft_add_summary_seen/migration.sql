-- AlterTable
ALTER TABLE "challenge_participants" ADD COLUMN     "summarySeenAt" TIMESTAMP(3);

-- Data migration: convert all draft challenges to active
UPDATE "challenges" SET status = 'active' WHERE status = 'draft';

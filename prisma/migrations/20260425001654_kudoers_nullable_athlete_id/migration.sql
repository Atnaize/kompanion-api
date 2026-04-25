-- DropIndex
DROP INDEX "public"."activity_kudoers_activityId_athleteId_key";

-- AlterTable
ALTER TABLE "activity_kudoers" ALTER COLUMN "athleteId" DROP NOT NULL;

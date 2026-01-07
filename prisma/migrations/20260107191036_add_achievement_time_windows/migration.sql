/*
  Warnings:

  - You are about to drop the column `activityWebhooks` on the `notification_preferences` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "achievements" ADD COLUMN     "validFrom" TIMESTAMP(3),
ADD COLUMN     "validUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notification_preferences" DROP COLUMN "activityWebhooks";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "achievementStartDate" TIMESTAMP(3);

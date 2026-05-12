/*
  Warnings:

  - Made the column `userId` on table `strava_api_usage` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "strava_api_usage" ALTER COLUMN "userId" SET NOT NULL;

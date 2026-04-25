-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "photoCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "activity_kudoers" (
    "id" TEXT NOT NULL,
    "activityId" BIGINT NOT NULL,
    "athleteId" BIGINT NOT NULL,
    "firstname" TEXT,
    "lastname" TEXT,
    "profile" TEXT,
    "profileMedium" TEXT,

    CONSTRAINT "activity_kudoers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_comments" (
    "id" BIGINT NOT NULL,
    "activityId" BIGINT NOT NULL,
    "athleteId" BIGINT NOT NULL,
    "athleteFirstname" TEXT,
    "athleteLastname" TEXT,
    "athleteProfile" TEXT,
    "athleteProfileMedium" TEXT,
    "text" TEXT NOT NULL,
    "commentedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_photos" (
    "uniqueId" TEXT NOT NULL,
    "activityId" BIGINT NOT NULL,
    "caption" TEXT,
    "urls" JSONB NOT NULL,
    "defaultPhoto" BOOLEAN NOT NULL DEFAULT false,
    "takenAt" TIMESTAMP(3),

    CONSTRAINT "activity_photos_pkey" PRIMARY KEY ("uniqueId")
);

-- CreateIndex
CREATE INDEX "activity_kudoers_activityId_idx" ON "activity_kudoers"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "activity_kudoers_activityId_athleteId_key" ON "activity_kudoers"("activityId", "athleteId");

-- CreateIndex
CREATE INDEX "activity_comments_activityId_idx" ON "activity_comments"("activityId");

-- CreateIndex
CREATE INDEX "activity_photos_activityId_idx" ON "activity_photos"("activityId");

-- AddForeignKey
ALTER TABLE "activity_kudoers" ADD CONSTRAINT "activity_kudoers_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_comments" ADD CONSTRAINT "activity_comments_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_photos" ADD CONSTRAINT "activity_photos_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "personal_records" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "distanceBand" TEXT NOT NULL,
    "distanceMeters" INTEGER NOT NULL,
    "bestTimeSeconds" INTEGER NOT NULL,
    "activityId" BIGINT NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_records_userId_distanceBand_bestTimeSeconds_idx" ON "personal_records"("userId", "distanceBand", "bestTimeSeconds");

-- CreateIndex
CREATE UNIQUE INDEX "personal_records_userId_distanceBand_activityId_key" ON "personal_records"("userId", "distanceBand", "activityId");

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

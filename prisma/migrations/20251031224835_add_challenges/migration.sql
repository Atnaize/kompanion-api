-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "creatorId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "targets" JSONB NOT NULL,
    "competitiveGoal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_participants" (
    "id" SERIAL NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "totalDistance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalElevation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),

    CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_activities" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "activityId" BIGINT NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "elevation" DOUBLE PRECISION NOT NULL,
    "movingTime" INTEGER NOT NULL,
    "activityType" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_events" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" INTEGER,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "challenges_status_endDate_idx" ON "challenges"("status", "endDate");

-- CreateIndex
CREATE INDEX "challenges_creatorId_idx" ON "challenges"("creatorId");

-- CreateIndex
CREATE INDEX "challenge_participants_userId_idx" ON "challenge_participants"("userId");

-- CreateIndex
CREATE INDEX "challenge_participants_challengeId_status_idx" ON "challenge_participants"("challengeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_participants_challengeId_userId_key" ON "challenge_participants"("challengeId", "userId");

-- CreateIndex
CREATE INDEX "challenge_activities_challengeId_userId_idx" ON "challenge_activities"("challengeId", "userId");

-- CreateIndex
CREATE INDEX "challenge_activities_challengeId_recordedAt_idx" ON "challenge_activities"("challengeId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_activities_challengeId_activityId_key" ON "challenge_activities"("challengeId", "activityId");

-- CreateIndex
CREATE INDEX "challenge_events_challengeId_createdAt_idx" ON "challenge_events"("challengeId", "createdAt");

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_activities" ADD CONSTRAINT "challenge_activities_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_activities" ADD CONSTRAINT "challenge_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_events" ADD CONSTRAINT "challenge_events_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

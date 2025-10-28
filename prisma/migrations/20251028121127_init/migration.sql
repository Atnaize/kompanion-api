-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "stravaId" INTEGER NOT NULL,
    "username" TEXT,
    "firstname" TEXT NOT NULL,
    "lastname" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "profileMedium" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" BIGINT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" BIGINT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sportType" TEXT NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "movingTime" INTEGER NOT NULL,
    "elapsedTime" INTEGER NOT NULL,
    "totalElevationGain" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "startDateLocal" TIMESTAMP(3) NOT NULL,
    "averageSpeed" DOUBLE PRECISION NOT NULL,
    "maxSpeed" DOUBLE PRECISION NOT NULL,
    "averageWatts" DOUBLE PRECISION,
    "kilojoules" DOUBLE PRECISION,
    "averageHeartrate" DOUBLE PRECISION,
    "maxHeartrate" DOUBLE PRECISION,
    "elevHigh" DOUBLE PRECISION,
    "elevLow" DOUBLE PRECISION,
    "kudosCount" INTEGER NOT NULL DEFAULT 0,
    "achievementCount" INTEGER NOT NULL DEFAULT 0,
    "prCount" INTEGER NOT NULL DEFAULT 0,
    "summaryPolyline" TEXT,
    "timezone" TEXT NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "trainer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "requirementValue" DOUBLE PRECISION NOT NULL,
    "activityType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "rewardXp" INTEGER NOT NULL,
    "rewardAchievements" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quest_objectives" (
    "id" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "activityType" TEXT,

    CONSTRAINT "quest_objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_quests" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "questId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "user_quests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "totalDistance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalElevation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalActivities" INTEGER NOT NULL DEFAULT 0,
    "totalTime" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_type_stats" (
    "id" SERIAL NOT NULL,
    "userStatsId" INTEGER NOT NULL,
    "activityType" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "distance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "elevation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "time" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "activity_type_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_stravaId_key" ON "users"("stravaId");

-- CreateIndex
CREATE INDEX "users_stravaId_idx" ON "users"("stravaId");

-- CreateIndex
CREATE INDEX "activities_userId_idx" ON "activities"("userId");

-- CreateIndex
CREATE INDEX "activities_startDate_idx" ON "activities"("startDate");

-- CreateIndex
CREATE INDEX "activities_type_idx" ON "activities"("type");

-- CreateIndex
CREATE INDEX "user_achievements_userId_idx" ON "user_achievements"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_userId_achievementId_key" ON "user_achievements"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "quest_objectives_questId_idx" ON "quest_objectives"("questId");

-- CreateIndex
CREATE INDEX "user_quests_userId_idx" ON "user_quests"("userId");

-- CreateIndex
CREATE INDEX "user_quests_status_idx" ON "user_quests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_quests_userId_questId_key" ON "user_quests"("userId", "questId");

-- CreateIndex
CREATE UNIQUE INDEX "user_stats_userId_key" ON "user_stats"("userId");

-- CreateIndex
CREATE INDEX "activity_type_stats_userStatsId_idx" ON "activity_type_stats"("userStatsId");

-- CreateIndex
CREATE UNIQUE INDEX "activity_type_stats_userStatsId_activityType_key" ON "activity_type_stats"("userStatsId", "activityType");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quest_objectives" ADD CONSTRAINT "quest_objectives_questId_fkey" FOREIGN KEY ("questId") REFERENCES "quests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quests" ADD CONSTRAINT "user_quests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quests" ADD CONSTRAINT "user_quests_questId_fkey" FOREIGN KEY ("questId") REFERENCES "quests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_type_stats" ADD CONSTRAINT "activity_type_stats_userStatsId_fkey" FOREIGN KEY ("userStatsId") REFERENCES "user_stats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

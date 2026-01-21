-- CreateIndex
CREATE INDEX "achievement_progress_achievementId_idx" ON "achievement_progress"("achievementId");

-- CreateIndex
CREATE INDEX "achievements_validFrom_validUntil_idx" ON "achievements"("validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "activities_userId_startDate_idx" ON "activities"("userId", "startDate");

-- CreateIndex
CREATE INDEX "activities_userId_startDateLocal_idx" ON "activities"("userId", "startDateLocal");

-- CreateIndex
CREATE INDEX "challenge_activities_userId_idx" ON "challenge_activities"("userId");

-- CreateIndex
CREATE INDEX "challenge_participants_userId_status_idx" ON "challenge_participants"("userId", "status");

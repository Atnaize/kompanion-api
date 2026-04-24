-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" SERIAL NOT NULL,
    "stravaId" INTEGER,
    "callbackUrl" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" BIGINT NOT NULL,
    "aspectType" TEXT NOT NULL,
    "ownerId" BIGINT NOT NULL,
    "subscriptionId" INTEGER NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "updates" JSONB,
    "rawPayload" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'strava',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "processingLog" JSONB,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_subscriptions_stravaId_key" ON "webhook_subscriptions"("stravaId");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_verifyToken_idx" ON "webhook_subscriptions"("verifyToken");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_status_idx" ON "webhook_subscriptions"("status");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- CreateIndex
CREATE INDEX "webhook_events_ownerId_idx" ON "webhook_events"("ownerId");

-- CreateIndex
CREATE INDEX "webhook_events_receivedAt_idx" ON "webhook_events"("receivedAt");

-- CreateIndex
CREATE INDEX "webhook_events_objectType_objectId_aspectType_eventTime_idx" ON "webhook_events"("objectType", "objectId", "aspectType", "eventTime");

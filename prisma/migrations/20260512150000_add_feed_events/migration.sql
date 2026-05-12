-- CreateTable
CREATE TABLE "feed_events" (
    "id" BIGSERIAL NOT NULL,
    "actorId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feed_events_actorId_createdAt_idx" ON "feed_events"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "feed_events_createdAt_idx" ON "feed_events"("createdAt");

-- AddForeignKey
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

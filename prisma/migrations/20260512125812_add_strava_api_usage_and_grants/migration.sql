-- CreateTable
CREATE TABLE "strava_api_usage" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "strava_api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strava_api_grants" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "grantedBy" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strava_api_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strava_api_usage_date_kind_idx" ON "strava_api_usage"("date", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "strava_api_usage_userId_date_kind_key" ON "strava_api_usage"("userId", "date", "kind");

-- CreateIndex
CREATE INDEX "strava_api_grants_userId_kind_validUntil_idx" ON "strava_api_grants"("userId", "kind", "validUntil");

-- CreateIndex
CREATE INDEX "strava_api_grants_validUntil_idx" ON "strava_api_grants"("validUntil");

-- AddForeignKey
ALTER TABLE "strava_api_usage" ADD CONSTRAINT "strava_api_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strava_api_grants" ADD CONSTRAINT "strava_api_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strava_api_grants" ADD CONSTRAINT "strava_api_grants_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

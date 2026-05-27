-- AlterTable
ALTER TABLE "challenges" ADD COLUMN "clubId" TEXT;

-- CreateIndex
CREATE INDEX "challenges_clubId_status_idx" ON "challenges"("clubId", "status");

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

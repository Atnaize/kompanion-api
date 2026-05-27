-- AlterTable
ALTER TABLE "challenge_participants" ADD COLUMN "chatMutedUntil" TIMESTAMP(3);
ALTER TABLE "challenge_participants" ADD COLUMN "lastReadAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "challenge_messages" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "challenge_messages_challengeId_id_idx" ON "challenge_messages"("challengeId", "id");

-- CreateIndex
CREATE INDEX "challenge_messages_userId_idx" ON "challenge_messages"("userId");

-- AddForeignKey
ALTER TABLE "challenge_messages" ADD CONSTRAINT "challenge_messages_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_messages" ADD CONSTRAINT "challenge_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

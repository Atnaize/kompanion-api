-- CreateTable
CREATE TABLE "user_blocks" (
    "id" SERIAL NOT NULL,
    "blockerId" INTEGER NOT NULL,
    "blockedId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mutes" (
    "id" SERIAL NOT NULL,
    "muterId" INTEGER NOT NULL,
    "mutedId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blockerId_blockedId_key" ON "user_blocks"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "user_blocks_blockedId_idx" ON "user_blocks"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "user_mutes_muterId_mutedId_key" ON "user_mutes"("muterId", "mutedId");

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mutes" ADD CONSTRAINT "user_mutes_muterId_fkey" FOREIGN KEY ("muterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mutes" ADD CONSTRAINT "user_mutes_mutedId_fkey" FOREIGN KEY ("mutedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

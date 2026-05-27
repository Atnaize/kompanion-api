-- Direct messages: give conversations the columns DMs need.
-- `dmKey` is a canonical "<minUserId>-<maxUserId>" string unique to a 1:1 DM, so
-- a DM can be upserted idempotently (mirrors the unique clubId/challengeId on
-- scoped conversations). `title` names a group DM. Both are null for club/
-- challenge conversations; `dmKey` is null for groups and `title` null for 1:1.
ALTER TABLE "conversations" ADD COLUMN "dmKey" TEXT;
ALTER TABLE "conversations" ADD COLUMN "title" TEXT;

-- Unique index allows multiple NULLs in Postgres, so non-DM and group rows are
-- unaffected while 1:1 DMs are deduplicated on their canonical pair key.
CREATE UNIQUE INDEX "conversations_dmKey_key" ON "conversations"("dmKey");

-- Replace per-challenge chat with a generic conversation layer.
-- Drops the old challenge-scoped chat tables/columns and creates a polymorphic
-- Conversation / ConversationParticipant / Message / MessageReaction model that
-- backs challenge chat, club chat, and (future) DMs uniformly. Chat data is not
-- yet in production, so the drop is unconditional — no data preservation.

-- 1. Drop old per-challenge chat artefacts.
DROP TABLE IF EXISTS "challenge_messages";
ALTER TABLE "challenge_participants" DROP COLUMN IF EXISTS "chatMutedUntil";
ALTER TABLE "challenge_participants" DROP COLUMN IF EXISTS "lastReadAt";

-- 2. Rename + extend notification preferences to be scope-agnostic.
ALTER TABLE "notification_preferences" RENAME COLUMN "challengeMessages" TO "chatMessages";
ALTER TABLE "notification_preferences" RENAME COLUMN "challengeMentions" TO "chatMentions";
ALTER TABLE "notification_preferences" ADD COLUMN "chatReactions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN "chatReplies" BOOLEAN NOT NULL DEFAULT true;

-- 3. Conversation: polymorphic owner via clubId/challengeId (mutually exclusive
--    for non-DM rows; both null for DMs).
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clubId" TEXT,
    "challengeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversations_clubId_key" ON "conversations"("clubId");
CREATE UNIQUE INDEX "conversations_challengeId_key" ON "conversations"("challengeId");
CREATE INDEX "conversations_kind_idx" ON "conversations"("kind");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_clubId_fkey"
    FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_challengeId_fkey"
    FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. ConversationParticipant: stores per-(conversation, user) chat state.
--    For DMs this is the membership source of truth; for CLUB/CHALLENGE
--    conversations it's a lazily-upserted cache of lastReadAt/mutedUntil.
CREATE TABLE "conversation_participants" (
    "id" SERIAL NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "mutedUntil" TIMESTAMP(3),
    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversation_participants_conversationId_userId_key"
    ON "conversation_participants"("conversationId", "userId");
CREATE INDEX "conversation_participants_userId_idx" ON "conversation_participants"("userId");
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Message: polymorphic via `kind`. 'text' = chat bubble (body set, author set);
--    'activity_digest' = daily roll-up card (payload set, author null); 'system'
--    reserved for future events. `parentId` enables one-level reply threads.
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" INTEGER,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "parentId" TEXT,
    "mentions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "messages_conversationId_id_idx" ON "messages"("conversationId", "id");
CREATE INDEX "messages_parentId_idx" ON "messages"("parentId");
CREATE INDEX "messages_authorId_idx" ON "messages"("authorId");
CREATE INDEX "messages_conversationId_kind_createdAt_idx" ON "messages"("conversationId", "kind", "createdAt");
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. MessageReaction: one row per (message, user, emoji). Allowlist enforced
--    in service code (👍 ❤️ 🔥 👏 🎉).
CREATE TABLE "message_reactions" (
    "id" SERIAL NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "message_reactions_messageId_userId_emoji_key"
    ON "message_reactions"("messageId", "userId", "emoji");
CREATE INDEX "message_reactions_messageId_idx" ON "message_reactions"("messageId");
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

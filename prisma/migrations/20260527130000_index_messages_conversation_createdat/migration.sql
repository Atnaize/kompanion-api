-- Index the chat timeline query: a conversation's messages ordered by
-- createdAt. The existing (conversationId, id) index can't serve it because
-- Message ids are random UUIDs, so cursor pagination now keys on (createdAt,
-- id). This index makes "newest N in a conversation" an index scan.
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

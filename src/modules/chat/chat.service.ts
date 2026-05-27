import { prisma } from '@shared/utils/index.js';
import type { Conversation, Message, MessageReaction, Prisma } from '@prisma/client';
import { notificationEmitter } from '../inbox/index.js';
import { privacyService } from '../privacy/index.js';
// Import the publisher file directly (not the realtime barrel) — the barrel
// pulls in the controller, which imports chat, which would cycle.
import { realtimePublisher } from '../realtime/realtime.publisher.js';
import {
  BODY_MAX,
  BODY_MIN,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  REACTION_EMOJIS,
  truncatePreview,
  type ReactionEmoji,
} from './chat.constants.js';
import { conversationResolver } from './conversation.resolver.js';
import type {
  ChatMessage,
  ChatPage,
  ChatUserSummary,
  ConversationSummary,
  DigestActivity,
  DigestPayload,
  MessageKind,
  MuteState,
  ReactionSummary,
  SystemPayload,
} from './chat.types.js';

const userSelect = {
  id: true,
  firstname: true,
  lastname: true,
  profile: true,
  profileMedium: true,
} satisfies Prisma.UserSelect;

type MessageWithRelations = Message & {
  author: ChatUserSummary | null;
  reactions: MessageReaction[];
  _count: { replies: number };
};

/**
 * `@firstname` resolver. Same algorithm as the old per-challenge chat: case
 * insensitive, unicode-safe, dedup by id-of-first-match. Pulled into the
 * generic service because it works the same regardless of scope.
 */
function parseMentions(
  body: string,
  candidates: Array<{ userId: number; firstname: string }>
): number[] {
  if (!body.includes('@')) return [];
  const byName = new Map<string, number>();
  for (const c of candidates) {
    const key = c.firstname.toLowerCase();
    if (!byName.has(key)) byName.set(key, c.userId);
  }
  const found = new Set<number>();
  const ordered: number[] = [];
  const re = /@([\p{L}\p{N}_]{1,40})/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const id = byName.get(match[1].toLowerCase());
    if (id !== undefined && !found.has(id)) {
      found.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Message ids are random UUIDs, so the cursor can't be the id alone — `id < x`
 * bears no relation to chat order. We page on the composite (createdAt, id):
 * the timestamp orders the timeline and the id is a stable tiebreaker for rows
 * sharing a millisecond. The cursor is the opaque base64url of both.
 */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = raw.indexOf('|');
  if (sep === -1) return null;
  const createdAt = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null;
  return { createdAt, id };
}

/**
 * Scope-agnostic chat service. Operates on `conversationId` exclusively —
 * callers resolve a conversation from a challenge/club via
 * `conversationResolver` first.
 *
 * Notification policy:
 *   - text message  → chat_message to other recipients (mute → silent push);
 *                     mentioned users get chat_mention instead (bypasses mute).
 *   - reply         → chat_reply to the parent's authors (= author for text,
 *                     digest contributors for activity_digest).
 *   - reaction      → chat_reaction to the target's authors (same rule).
 *   - activity_digest creation/update → NO chat notification. The existing
 *                     `challenge_activity_added` notification covers the
 *                     "someone logged a run" signal at a coarser cadence.
 */
export class ChatService {
  async listMessages(
    conversationId: string,
    viewerId: number,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<ChatPage> {
    await conversationResolver.loadForViewer(conversationId, viewerId);

    const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        // Replies are surfaced inside the parent — keep the main timeline flat.
        parentId: null,
        // Page backwards through (createdAt, id) — see decodeCursor for why an
        // id-only cursor can't work here.
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        author: { select: userSelect },
        reactions: true,
        _count: { select: { replies: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      messages: page.map((row) => this.hydrate(row, viewerId)),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  async listReplies(
    conversationId: string,
    messageId: string,
    viewerId: number,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<ChatPage> {
    await conversationResolver.loadForViewer(conversationId, viewerId);

    const parent = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true },
    });
    if (!parent) {
      throw new Error('Message not found');
    }

    const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    // Replies in chronological order (oldest first) — they read like a thread,
    // not a feed. Cursor is the last seen (createdAt, id); "give me after this".
    const rows = await prisma.message.findMany({
      where: {
        parentId: messageId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        author: { select: userSelect },
        reactions: true,
        _count: { select: { replies: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      messages: page.map((row) => this.hydrate(row, viewerId)),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  /**
   * Post a text message. When `parentId` is set, the message is a reply and
   * fires `chat_reply` instead of `chat_message`. Mentions parse against the
   * conversation's recipient set (excludes the author) and override mute on
   * the recipient side via `chat_mention`.
   */
  async sendMessage(
    conversationId: string,
    authorId: number,
    body: string,
    parentId?: string | null
  ): Promise<ChatMessage> {
    const trimmed = body.trim();
    if (trimmed.length < BODY_MIN || trimmed.length > BODY_MAX) {
      throw new Error(`Message must be ${BODY_MIN}–${BODY_MAX} characters`);
    }

    const { conversation, summary } = await conversationResolver.loadForViewer(
      conversationId,
      authorId
    );

    // Validate the parent message lives in this conversation. Disallow nesting:
    // a parent that is itself a reply would create a tree. Keep replies one
    // level deep (Slack-style) — the UI assumes this.
    let parent: { id: string; kind: string; authorId: number | null; payload: Prisma.JsonValue } | null = null;
    if (parentId) {
      parent = await prisma.message.findFirst({
        where: { id: parentId, conversationId, parentId: null },
        select: { id: true, kind: true, authorId: true, payload: true },
      });
      if (!parent) {
        throw new Error('Parent message not found');
      }
    }

    const recipients = await conversationResolver.listRecipients(conversation, authorId);
    const mentionedIds = parseMentions(trimmed, recipients);

    const author = await prisma.user.findUnique({
      where: { id: authorId },
      select: userSelect,
    });
    if (!author) {
      throw new Error('FORBIDDEN: unknown user');
    }

    // Transaction: create the message and bump the author's `lastReadAt` so
    // their own send doesn't inflate their unread badge.
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId,
          authorId,
          kind: 'text',
          body: trimmed,
          parentId: parentId ?? null,
          mentions: mentionedIds.length > 0 ? (mentionedIds as Prisma.InputJsonValue) : undefined,
        },
        include: {
          author: { select: userSelect },
          reactions: true,
          _count: { select: { replies: true } },
        },
      }),
      this.upsertParticipantStateTx(conversationId, authorId, { lastReadAt: new Date() }),
    ]);

    // Fire-and-forget notifications.
    void this.dispatchTextNotifications({
      authorId,
      authorName: `${author.firstname} ${author.lastname}`,
      conversation,
      summary,
      body: trimmed,
      mentionedIds,
      recipientIds: recipients.map((r) => r.userId),
      parent,
    }).catch((err) => console.error('[Chat] text notification dispatch failed:', err));

    // Realtime: bump the thread, plus every recipient's inbox and the author's
    // own (other devices). Best-effort; no-ops when Ably is unconfigured.
    void realtimePublisher.publishToConversation(conversationId);
    void realtimePublisher.publishToUser(authorId);
    for (const recipient of recipients) {
      void realtimePublisher.publishToUser(recipient.userId);
    }

    return this.hydrate(message, authorId);
  }

  async markRead(conversationId: string, userId: number): Promise<void> {
    await conversationResolver.loadForViewer(conversationId, userId);
    await this.upsertParticipantState(conversationId, userId, { lastReadAt: new Date() });
  }

  async unreadCount(conversationId: string, userId: number): Promise<number> {
    await conversationResolver.loadForViewer(conversationId, userId);
    const state = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadAt: true },
    });
    return prisma.message.count({
      where: {
        conversationId,
        // Replies count if the parent itself is unread — keep it simple, ignore
        // reply-only deltas for v1.
        parentId: null,
        // System notices (joined/left/created) are ambient — never unread.
        kind: { not: 'system' },
        // Authored by anyone but the viewer; digest messages have authorId=null,
        // include them in unread (they're a signal the viewer hasn't seen).
        OR: [{ authorId: null }, { authorId: { not: userId } }],
        ...(state?.lastReadAt ? { createdAt: { gt: state.lastReadAt } } : {}),
      },
    });
  }

  async getMuteState(conversationId: string, userId: number): Promise<MuteState> {
    await conversationResolver.loadForViewer(conversationId, userId);
    const state = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { mutedUntil: true },
    });
    return { mutedUntil: state?.mutedUntil ? state.mutedUntil.toISOString() : null };
  }

  async setMute(
    conversationId: string,
    userId: number,
    mutedUntil: Date | null
  ): Promise<MuteState> {
    await conversationResolver.loadForViewer(conversationId, userId);
    if (mutedUntil && mutedUntil.getTime() < Date.now() - 1000) {
      throw new Error('mutedUntil must be in the future');
    }
    const updated = await this.upsertParticipantState(conversationId, userId, { mutedUntil });
    return { mutedUntil: updated.mutedUntil ? updated.mutedUntil.toISOString() : null };
  }

  /**
   * Add a reaction. Idempotent: a duplicate (message, user, emoji) trips the
   * unique constraint and is swallowed, so a repeat POST is a silent no-op (and
   * doesn't re-notify). Emoji must be in the allowlist.
   */
  async addReaction(
    conversationId: string,
    messageId: string,
    userId: number,
    emoji: string
  ): Promise<ReactionSummary[]> {
    if (!REACTION_EMOJIS.includes(emoji as ReactionEmoji)) {
      throw new Error(`Unsupported reaction: ${emoji}`);
    }
    const { conversation, summary } = await conversationResolver.loadForViewer(
      conversationId,
      userId
    );
    const target = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, kind: true, authorId: true, body: true, payload: true },
    });
    if (!target) {
      throw new Error('Message not found');
    }

    // Insert and let the unique (messageId, userId, emoji) index enforce
    // idempotency: a duplicate raises P2002, which we swallow. `created` is
    // false on a duplicate so we don't re-notify on a double-tap.
    const created = await prisma.messageReaction
      .create({ data: { messageId, userId, emoji } })
      .then(() => true)
      .catch((err: unknown) => {
        if (err && typeof err === 'object' && (err as { code?: string }).code === 'P2002') {
          return false;
        }
        throw err;
      });

    if (created) {
      const actor = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstname: true, lastname: true },
      });

      const recipients = this.recipientsForMessage(target, userId);
      void this.dispatchReactionNotifications({
        conversation,
        summary,
        actorId: userId,
        actorName: actor ? `${actor.firstname} ${actor.lastname}` : 'Someone',
        emoji,
        messageId,
        messagePreview: this.previewForMessage(target),
        recipientIds: recipients,
      }).catch((err) => console.error('[Chat] reaction notification failed:', err));

      void realtimePublisher.publishToConversation(conversationId);
    }

    return this.listReactions(messageId, userId);
  }

  async removeReaction(
    conversationId: string,
    messageId: string,
    userId: number,
    emoji: string
  ): Promise<ReactionSummary[]> {
    await conversationResolver.loadForViewer(conversationId, userId);
    await prisma.messageReaction
      .delete({ where: { messageId_userId_emoji: { messageId, userId, emoji } } })
      .catch(() => undefined); // P2025 = not found; idempotent delete
    void realtimePublisher.publishToConversation(conversationId);
    return this.listReactions(messageId, userId);
  }

  // -- internals --

  private async listReactions(messageId: string, viewerId: number): Promise<ReactionSummary[]> {
    const rows = await prisma.messageReaction.findMany({
      where: { messageId },
      orderBy: { createdAt: 'asc' },
      select: { emoji: true, userId: true },
    });
    return aggregateReactions(rows, viewerId);
  }

  private hydrate(row: MessageWithRelations, viewerId: number): ChatMessage {
    const kind = row.kind as MessageKind;
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind,
      author: row.author,
      body: row.body,
      digest: kind === 'activity_digest' ? (row.payload as unknown as DigestPayload) : null,
      system: kind === 'system' ? (row.payload as unknown as SystemPayload) : null,
      parentId: row.parentId,
      mentions: normaliseMentions(row.mentions),
      reactions: aggregateReactions(row.reactions, viewerId),
      replyCount: row._count.replies,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    };
  }

  /**
   * Compute notification recipients for an event on `message`:
   *   - text:            the author (if not the actor)
   *   - activity_digest: every contributor in `payload.activities` (deduped,
   *                      excluding the actor) — the people the card is "about"
   *   - system:          no one
   */
  private recipientsForMessage(
    message: { kind: string; authorId: number | null; payload: Prisma.JsonValue },
    actorId: number
  ): number[] {
    if (message.kind === 'text') {
      if (message.authorId && message.authorId !== actorId) {
        return [message.authorId];
      }
      return [];
    }
    if (message.kind === 'activity_digest') {
      const payload = message.payload as DigestPayload | null;
      if (!payload || !Array.isArray(payload.activities)) return [];
      const uniq = new Set<number>();
      for (const a of payload.activities) {
        if (a.userId !== actorId) uniq.add(a.userId);
      }
      return [...uniq];
    }
    return [];
  }

  private previewForMessage(message: {
    kind: string;
    body: string | null;
    payload: Prisma.JsonValue;
  }): string {
    if (message.kind === 'text' && message.body) {
      return truncatePreview(message.body);
    }
    if (message.kind === 'activity_digest') {
      const payload = message.payload as DigestPayload | null;
      const count = payload?.activities?.length ?? 0;
      return `Activity recap (${count})`;
    }
    return '…';
  }

  private async dispatchTextNotifications(opts: {
    authorId: number;
    authorName: string;
    conversation: Conversation;
    summary: ConversationSummary;
    body: string;
    mentionedIds: number[];
    recipientIds: number[];
    // When non-null, the message is a reply — fire chat_reply to the parent's
    // recipients on top of (or instead of) the generic chat_message fan-out.
    parent: { id: string; kind: string; authorId: number | null; payload: Prisma.JsonValue } | null;
  }): Promise<void> {
    const blocked = await privacyService.getBlockedPair(opts.authorId);
    const generalTargets = opts.recipientIds.filter((id) => !blocked.has(id));
    const mentionedSet = new Set(opts.mentionedIds);
    const preview = truncatePreview(opts.body);

    // Per-recipient mute lookup so muted users still get the in-app inbox row
    // but no banner. Mentions bypass mute.
    const mutedRows =
      generalTargets.length > 0
        ? await prisma.conversationParticipant.findMany({
            where: {
              conversationId: opts.conversation.id,
              userId: { in: generalTargets },
              mutedUntil: { gt: new Date() },
            },
            select: { userId: true },
          })
        : [];
    const mutedIds = new Set(mutedRows.map((r) => r.userId));

    // Reply fan-out goes to the parent's recipients (author for text parents,
    // contributors for activity_digest parents). chat_reply has its own pref
    // so we keep this separate from chat_message even when targets overlap.
    const replyTargets = opts.parent
      ? this.recipientsForMessage(opts.parent, opts.authorId).filter((id) => !blocked.has(id))
      : [];

    await Promise.all([
      ...generalTargets.map((recipientId) => {
        if (mentionedSet.has(recipientId)) {
          return notificationEmitter
            .record(
              recipientId,
              {
                type: 'chat_mention',
                entityType: 'conversation',
                entityId: opts.conversation.id,
                metadata: {
                  scopeName: opts.summary.scopeName,
                  scopeKind: opts.summary.kind,
                  conversationId: opts.conversation.id,
                  senderName: opts.authorName,
                  preview,
                },
              },
              { actorId: opts.authorId }
            )
            .catch((err) => console.error('[Inbox] chat_mention failed:', err));
        }
        return notificationEmitter
          .record(
            recipientId,
            {
              type: 'chat_message',
              entityType: 'conversation',
              entityId: opts.conversation.id,
              metadata: {
                scopeName: opts.summary.scopeName,
                scopeKind: opts.summary.kind,
                conversationId: opts.conversation.id,
                senderName: opts.authorName,
                preview,
              },
            },
            { actorId: opts.authorId, silent: mutedIds.has(recipientId) }
          )
          .catch((err) => console.error('[Inbox] chat_message failed:', err));
      }),
      ...replyTargets.map((recipientId) =>
        notificationEmitter
          .record(
            recipientId,
            {
              type: 'chat_reply',
              entityType: 'message',
              entityId: opts.parent!.id,
              metadata: {
                scopeName: opts.summary.scopeName,
                scopeKind: opts.summary.kind,
                conversationId: opts.conversation.id,
                actorName: opts.authorName,
                preview,
              },
            },
            { actorId: opts.authorId, silent: mutedIds.has(recipientId) }
          )
          .catch((err) => console.error('[Inbox] chat_reply failed:', err))
      ),
    ]);
  }

  private async dispatchReactionNotifications(opts: {
    conversation: Conversation;
    summary: ConversationSummary;
    actorId: number;
    actorName: string;
    emoji: string;
    messageId: string;
    messagePreview: string;
    recipientIds: number[];
  }): Promise<void> {
    if (opts.recipientIds.length === 0) return;
    const blocked = await privacyService.getBlockedPair(opts.actorId);
    const targets = opts.recipientIds.filter((id) => !blocked.has(id));
    if (targets.length === 0) return;

    // Reactions respect per-conversation mute — they're a softer signal than
    // an @mention and a noisy reaction stream shouldn't fight the user's mute.
    const mutedRows = await prisma.conversationParticipant.findMany({
      where: {
        conversationId: opts.conversation.id,
        userId: { in: targets },
        mutedUntil: { gt: new Date() },
      },
      select: { userId: true },
    });
    const mutedIds = new Set(mutedRows.map((r) => r.userId));

    await Promise.all(
      targets.map((recipientId) =>
        notificationEmitter
          .record(
            recipientId,
            {
              type: 'chat_reaction',
              entityType: 'message',
              entityId: opts.messageId,
              metadata: {
                scopeName: opts.summary.scopeName,
                scopeKind: opts.summary.kind,
                conversationId: opts.conversation.id,
                actorName: opts.actorName,
                emoji: opts.emoji,
                messagePreview: opts.messagePreview,
              },
            },
            { actorId: opts.actorId, silent: mutedIds.has(recipientId) }
          )
          .catch((err) => console.error('[Inbox] chat_reaction failed:', err))
      )
    );
  }

  private async upsertParticipantState(
    conversationId: string,
    userId: number,
    patch: { lastReadAt?: Date | null; mutedUntil?: Date | null }
  ) {
    return prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      update: patch,
      create: {
        conversationId,
        userId,
        lastReadAt: patch.lastReadAt ?? null,
        mutedUntil: patch.mutedUntil ?? null,
      },
    });
  }

  /**
   * Same upsert as `upsertParticipantState` but returned as a Prisma query so
   * it can be composed inside a `$transaction([...])` call.
   */
  private upsertParticipantStateTx(
    conversationId: string,
    userId: number,
    patch: { lastReadAt?: Date | null; mutedUntil?: Date | null }
  ) {
    return prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      update: patch,
      create: {
        conversationId,
        userId,
        lastReadAt: patch.lastReadAt ?? null,
        mutedUntil: patch.mutedUntil ?? null,
      },
    });
  }
}

function normaliseMentions(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === 'number' && Number.isInteger(v));
}

function aggregateReactions(
  rows: Array<{ emoji: string; userId: number }>,
  viewerId: number
): ReactionSummary[] {
  const buckets = new Map<string, ReactionSummary>();
  for (const row of rows) {
    const bucket = buckets.get(row.emoji) ?? {
      emoji: row.emoji,
      userIds: [],
      viewerReacted: false,
    };
    bucket.userIds.push(row.userId);
    if (row.userId === viewerId) bucket.viewerReacted = true;
    buckets.set(row.emoji, bucket);
  }
  // Stable order: by first-reaction time (insertion order in the rows array).
  return [...buckets.values()];
}

export const chatService = new ChatService();

// Re-exports for tests / activity-digest service.
export { aggregateReactions, normaliseMentions };
export type { DigestActivity };

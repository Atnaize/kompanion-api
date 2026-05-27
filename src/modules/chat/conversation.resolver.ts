import { prisma } from '@shared/utils/index.js';
import type { Conversation } from '@prisma/client';
import { FriendsService } from '../friends/friends.service.js';
import type { ChatScopeKind, ConversationSummary } from './chat.types.js';

/**
 * Resolves a conversation row from a scope (challenge/club) and checks that the
 * viewer is allowed to read/write it. Conversations are created lazily: the
 * first time anyone hits chat on a challenge or club, the corresponding row is
 * inserted. This keeps the rest of the codebase free of "also create the
 * conversation" hooks on every challenge/club mutation.
 *
 * Membership source-of-truth differs by scope:
 *   - challenge: ChallengeParticipant where status='accepted'
 *   - club:      ClubMember where status='active'
 *   - dm:        ConversationParticipant (DMs have no other source — out of
 *                scope for v1 controllers but the resolver can authenticate them).
 */
class ConversationResolver {
  private friendsService = new FriendsService();

  /**
   * Get or create the conversation for a challenge, asserting the viewer is an
   * accepted participant. Returns both the row and a summary (scope name etc.)
   * suitable for echoing back to the client.
   */
  async resolveChallengeForViewer(
    challengeId: string,
    viewerId: number
  ): Promise<{ conversation: Conversation; summary: ConversationSummary }> {
    // We fetch the challenge + the viewer's participant row in one go so we
    // can authorize and surface the scope name without a second roundtrip.
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        name: true,
        participants: {
          where: { userId: viewerId },
          select: { status: true },
          take: 1,
        },
      },
    });
    if (!challenge) {
      throw new Error('Challenge not found');
    }
    const participant = challenge.participants[0];
    if (!participant || participant.status !== 'accepted') {
      throw new Error('FORBIDDEN: not a challenge participant');
    }

    const conversation = await this.upsertScopedConversation('challenge', { challengeId });
    return {
      conversation,
      summary: {
        id: conversation.id,
        kind: 'challenge',
        scopeName: challenge.name,
        scopeId: challenge.id,
        image: null,
      },
    };
  }

  /**
   * Get or create the conversation for a club, asserting the viewer is an
   * active member.
   */
  async resolveClubForViewer(
    clubId: string,
    viewerId: number
  ): Promise<{ conversation: Conversation; summary: ConversationSummary }> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: {
        id: true,
        name: true,
        members: {
          where: { userId: viewerId },
          select: { status: true },
          take: 1,
        },
      },
    });
    if (!club) {
      throw new Error('Club not found');
    }
    const member = club.members[0];
    if (!member || member.status !== 'active') {
      throw new Error('FORBIDDEN: not a club member');
    }

    const conversation = await this.upsertScopedConversation('club', { clubId });
    return {
      conversation,
      summary: {
        id: conversation.id,
        kind: 'club',
        scopeName: club.name,
        scopeId: club.id,
        image: null,
      },
    };
  }

  /**
   * Get or create the 1:1 DM between the viewer and another user, asserting
   * they are accepted friends. Idempotent via the canonical `dmKey`; ensures a
   * participant row exists for both sides, then returns the standard summary.
   */
  async resolveDmForViewer(
    viewerId: number,
    otherUserId: number
  ): Promise<{ conversation: Conversation; summary: ConversationSummary }> {
    if (viewerId === otherUserId) {
      throw new Error('Cannot start a direct message with yourself');
    }
    // Friends-only. Self is already rejected above, so this asserts an accepted
    // friendship via the central privacy chokepoint.
    await this.friendsService.assertFriendsOrSelf(viewerId, otherUserId);

    const dmKey = `${Math.min(viewerId, otherUserId)}-${Math.max(viewerId, otherUserId)}`;
    const conversation = await prisma.conversation.upsert({
      where: { dmKey },
      update: {},
      create: { kind: 'dm', dmKey },
    });

    await prisma.$transaction([
      this.ensureParticipantTx(conversation.id, viewerId),
      this.ensureParticipantTx(conversation.id, otherUserId),
    ]);

    return this.loadForViewer(conversation.id, viewerId);
  }

  /**
   * Load a conversation by id and assert the viewer is allowed to read it.
   * Used by every chat endpoint after the client has resolved a conversation
   * id from a scope (challenge/club). Looks up the conversation, then dispatches
   * to the scope-specific membership check.
   */
  async loadForViewer(
    conversationId: string,
    viewerId: number
  ): Promise<{ conversation: Conversation; summary: ConversationSummary }> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        club: { select: { id: true, name: true } },
        challenge: { select: { id: true, name: true } },
      },
    });
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    if (conversation.kind === 'challenge' && conversation.challenge) {
      const participant = await prisma.challengeParticipant.findUnique({
        where: { challengeId_userId: { challengeId: conversation.challenge.id, userId: viewerId } },
        select: { status: true },
      });
      if (!participant || participant.status !== 'accepted') {
        throw new Error('FORBIDDEN: not a challenge participant');
      }
      return {
        conversation,
        summary: {
          id: conversation.id,
          kind: 'challenge',
          scopeName: conversation.challenge.name,
          scopeId: conversation.challenge.id,
          image: null,
        },
      };
    }

    if (conversation.kind === 'club' && conversation.club) {
      const member = await prisma.clubMember.findUnique({
        where: { clubId_userId: { clubId: conversation.club.id, userId: viewerId } },
        select: { status: true },
      });
      if (!member || member.status !== 'active') {
        throw new Error('FORBIDDEN: not a club member');
      }
      return {
        conversation,
        summary: {
          id: conversation.id,
          kind: 'club',
          scopeName: conversation.club.name,
          scopeId: conversation.club.id,
          image: null,
        },
      };
    }

    if (conversation.kind === 'dm') {
      // DMs gate on ConversationParticipant directly — the table is the source
      // of truth.
      const participant = await prisma.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId: conversation.id, userId: viewerId } },
        select: { id: true },
      });
      if (!participant) {
        throw new Error('FORBIDDEN: not a DM participant');
      }
      const { scopeName, image } = await this.dmSummaryFields(
        conversation.id,
        viewerId,
        conversation.title
      );
      return {
        conversation,
        summary: { id: conversation.id, kind: 'dm', scopeName, scopeId: null, image },
      };
    }

    throw new Error('Conversation kind not recognised');
  }

  /**
   * Eagerly create (or fetch) a club's conversation. Called when a club is
   * created so its chat exists from day one rather than lazily on first open.
   */
  async ensureClubConversation(clubId: string): Promise<Conversation> {
    return this.upsertScopedConversation('club', { clubId });
  }

  /**
   * Recipients for a given scope, used for fan-out of notifications and to
   * resolve `@firstname` mentions. Excludes the actor.
   */
  async listRecipients(
    conversation: Conversation,
    excludeUserId: number
  ): Promise<Array<{ userId: number; firstname: string }>> {
    if (conversation.kind === 'challenge' && conversation.challengeId) {
      const participants = await prisma.challengeParticipant.findMany({
        where: {
          challengeId: conversation.challengeId,
          status: 'accepted',
          userId: { not: excludeUserId },
        },
        select: { userId: true, user: { select: { firstname: true } } },
      });
      return participants.map((p) => ({ userId: p.userId, firstname: p.user.firstname }));
    }
    if (conversation.kind === 'club' && conversation.clubId) {
      const members = await prisma.clubMember.findMany({
        where: {
          clubId: conversation.clubId,
          status: 'active',
          userId: { not: excludeUserId },
        },
        select: { userId: true, user: { select: { firstname: true } } },
      });
      return members.map((m) => ({ userId: m.userId, firstname: m.user.firstname }));
    }
    // DM — use ConversationParticipant.
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId: conversation.id, userId: { not: excludeUserId } },
      select: { userId: true, user: { select: { firstname: true } } },
    });
    return participants.map((p) => ({ userId: p.userId, firstname: p.user.firstname }));
  }

  /**
   * Idempotent participant upsert, returned as a Prisma query so it can be
   * composed inside a `$transaction([...])`. A no-op on re-resolve.
   */
  private ensureParticipantTx(conversationId: string, userId: number, role = 'member') {
    return prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      update: {},
      create: { conversationId, userId, role },
    });
  }

  /**
   * Display name + avatar for a DM conversation, from the viewer's perspective.
   *   1:1   → the other person's full name and profile photo.
   *   group → the title; or a composed list of first names when untitled, and
   *           no single avatar.
   */
  private async dmSummaryFields(
    conversationId: string,
    viewerId: number,
    title: string | null
  ): Promise<{ scopeName: string; image: string | null }> {
    const others = await prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: viewerId } },
      select: { user: { select: { firstname: true, lastname: true, profile: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    if (title) {
      return { scopeName: title, image: null };
    }
    if (others.length === 1) {
      const u = others[0].user;
      return { scopeName: `${u.firstname} ${u.lastname}`.trim(), image: u.profile };
    }
    const names = others.map((o) => o.user.firstname).filter(Boolean);
    const scopeName =
      names.length === 0
        ? 'Group'
        : names.length <= 3
          ? names.join(', ')
          : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
    return { scopeName, image: null };
  }

  /**
   * Upsert the conversation row for a club/challenge. Idempotent: the unique
   * index on clubId/challengeId guarantees one row per scope. Prisma's `upsert`
   * isn't atomic, so a genuinely concurrent first-access can still lose with a
   * P2002 — but the unique index keeps that the worst case (a transient error
   * the client retries), never a duplicate conversation.
   */
  private async upsertScopedConversation(
    kind: Extract<ChatScopeKind, 'club' | 'challenge'>,
    scope: { clubId?: string; challengeId?: string }
  ): Promise<Conversation> {
    if (kind === 'challenge') {
      return prisma.conversation.upsert({
        where: { challengeId: scope.challengeId },
        update: {},
        create: { kind, challengeId: scope.challengeId },
      });
    }
    return prisma.conversation.upsert({
      where: { clubId: scope.clubId },
      update: {},
      create: { kind, clubId: scope.clubId },
    });
  }
}

export const conversationResolver = new ConversationResolver();

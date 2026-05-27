import { prisma } from '@shared/utils/index.js';
import type { Prisma } from '@prisma/client';
import { FriendsService } from '../friends/friends.service.js';
import { realtimePublisher } from '../realtime/realtime.publisher.js';
import { conversationResolver } from './conversation.resolver.js';
import { truncatePreview } from './chat.constants.js';
import type {
  ChatScopeKind,
  ChatUserSummary,
  ConversationListItem,
  ConversationSummary,
  DigestPayload,
  SystemPayload,
} from './chat.types.js';

const TITLE_MAX = 80;
const GROUP_MIN_OTHERS = 2; // a 2-person "group" is just a 1:1 DM

const userSummarySelect = {
  id: true,
  firstname: true,
  lastname: true,
  profile: true,
  profileMedium: true,
} satisfies Prisma.UserSelect;

/**
 * One candidate conversation for the viewer's inbox, before last-message /
 * unread enrichment. Unions the three membership sources (DM participants,
 * active club members, accepted challenge participants).
 */
interface Candidate {
  id: string;
  kind: ChatScopeKind;
  scopeId: string | null;
  /** Club/challenge name. Null for DMs. */
  scopeName: string | null;
  /** Group DM title. Null for 1:1 DMs and scoped conversations. */
  title: string | null;
  createdAt: Date;
}

/**
 * Conversation lifecycle (DM resolve lives on the resolver; group create +
 * membership management live here) and the unified inbox aggregation. Message
 * operations stay in `chatService`; read/membership gating stays in
 * `conversationResolver`.
 */
export class ConversationsService {
  private friendsService = new FriendsService();

  // -- Group DMs --

  /**
   * Create a group DM. The creator becomes `owner`; everyone else is a friend
   * of the creator (enforced). A group needs at least 3 people total — fewer
   * is a 1:1 DM, which goes through `conversationResolver.resolveDmForViewer`.
   */
  async createGroup(
    creatorId: number,
    userIds: number[],
    title?: string | null
  ): Promise<ConversationSummary> {
    const others = [...new Set(userIds)].filter((id) => id !== creatorId);
    if (others.length < GROUP_MIN_OTHERS) {
      throw new Error('A group needs at least 3 members');
    }
    await this.assertFriends(creatorId, others);

    const trimmed = title?.trim();
    const conversation = await prisma.conversation.create({
      data: {
        kind: 'dm',
        title: trimmed ? trimmed.slice(0, TITLE_MAX) : null,
        participants: {
          create: [
            { userId: creatorId, role: 'owner' },
            ...others.map((userId) => ({ userId, role: 'member' })),
          ],
        },
      },
    });

    return (await conversationResolver.loadForViewer(conversation.id, creatorId)).summary;
  }

  /** Add friends of the actor to a group DM. */
  async addParticipants(
    actorId: number,
    conversationId: string,
    userIds: number[]
  ): Promise<void> {
    await this.loadGroupForActor(conversationId, actorId);
    const toAdd = [...new Set(userIds)].filter((id) => id !== actorId);
    if (toAdd.length === 0) return;
    await this.assertFriends(actorId, toAdd);
    await prisma.$transaction(
      toAdd.map((userId) =>
        prisma.conversationParticipant.upsert({
          where: { conversationId_userId: { conversationId, userId } },
          update: {},
          create: { conversationId, userId, role: 'member' },
        })
      )
    );
  }

  /**
   * Remove a member from a group DM. Anyone may remove themselves (leave); only
   * the owner may remove others. If the owner leaves, ownership transfers to the
   * earliest-joined remaining member.
   */
  async removeParticipant(
    actorId: number,
    conversationId: string,
    targetUserId: number
  ): Promise<void> {
    const { role } = await this.loadGroupForActor(conversationId, actorId);
    if (targetUserId !== actorId && role !== 'owner') {
      throw new Error('FORBIDDEN: only the group owner can remove members');
    }
    await prisma.conversationParticipant
      .delete({ where: { conversationId_userId: { conversationId, userId: targetUserId } } })
      .catch(() => undefined); // idempotent — already gone is fine
    await this.ensureOwner(conversationId);
  }

  /** Leave a group DM. */
  async leave(actorId: number, conversationId: string): Promise<void> {
    await this.removeParticipant(actorId, conversationId, actorId);
  }

  // -- Club chat sync --
  //
  // Club chat membership is *derived* from ClubMember (loadForViewer +
  // listRecipients read it live), so these don't gate access — they keep the
  // ConversationParticipant cache rows in step with membership and post a
  // system notice so the thread visibly reflects who joined/left.

  /** Ensure a club's conversation exists. Call when the club is created. */
  async ensureClubConversation(clubId: string): Promise<string> {
    const conversation = await conversationResolver.ensureClubConversation(clubId);
    return conversation.id;
  }

  /**
   * Reflect a member becoming active in a club: ensure the conversation, add
   * the participant row, and announce it. `asCreator` posts the "created the
   * club" notice instead of "joined".
   */
  async onClubMemberJoined(
    clubId: string,
    userId: number,
    options: { asCreator?: boolean } = {}
  ): Promise<void> {
    const conversation = await conversationResolver.ensureClubConversation(clubId);
    await prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      update: {},
      create: { conversationId: conversation.id, userId, role: 'member' },
    });
    const name = await this.userName(userId);
    if (options.asCreator) {
      await this.postSystemMessage(
        conversation.id,
        { event: 'club_created', userId, actorName: name },
        `${name} created the club`
      );
    } else {
      await this.postSystemMessage(
        conversation.id,
        { event: 'member_joined', userId, actorName: name },
        `${name} joined`
      );
    }
  }

  /** Reflect a member leaving/removed from a club: drop the row + announce. */
  async onClubMemberLeft(clubId: string, userId: number): Promise<void> {
    const conversation = await prisma.conversation.findUnique({
      where: { clubId },
      select: { id: true },
    });
    if (!conversation) return;
    await prisma.conversationParticipant
      .delete({ where: { conversationId_userId: { conversationId: conversation.id, userId } } })
      .catch(() => undefined);
    const name = await this.userName(userId);
    await this.postSystemMessage(
      conversation.id,
      { event: 'member_left', userId, actorName: name },
      `${name} left`
    );
  }

  // -- Inbox --

  /**
   * Unified Messages inbox: every conversation the viewer can see (DMs, groups,
   * club chats, challenge chats), each with a last-message preview, unread count
   * and mute state, sorted by most recent activity. Empty club/challenge chats
   * are hidden so the list only surfaces conversations that have happened; empty
   * DMs are kept (the viewer explicitly opened them).
   */
  async listConversations(viewerId: number): Promise<ConversationListItem[]> {
    const candidates = await this.gatherCandidates(viewerId);
    if (candidates.length === 0) return [];

    const ids = candidates.map((c) => c.id);
    const dmIds = candidates.filter((c) => c.kind === 'dm').map((c) => c.id);
    const [stateMap, membersMap] = await Promise.all([
      this.readStateMap(viewerId, ids),
      this.dmMembersMap(viewerId, dmIds),
    ]);

    const now = Date.now();
    const enriched = await Promise.all(
      candidates.map(async (c) => {
        const state = stateMap.get(c.id);
        const lastReadAt = state?.lastReadAt ?? null;
        const [last, unreadCount] = await Promise.all([
          prisma.message.findFirst({
            where: { conversationId: c.id, parentId: null },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
              kind: true,
              body: true,
              payload: true,
              createdAt: true,
              authorId: true,
              author: { select: { firstname: true, lastname: true } },
            },
          }),
          this.countUnread(c.id, viewerId, c.kind, lastReadAt),
        ]);
        return { c, last, unreadCount, mutedUntil: state?.mutedUntil ?? null };
      })
    );

    const items: ConversationListItem[] = [];
    for (const { c, last, unreadCount, mutedUntil } of enriched) {
      // Hide club/challenge chats nobody has posted in yet.
      if (c.kind !== 'dm' && !last) continue;

      const members = c.kind === 'dm' ? (membersMap.get(c.id) ?? []) : [];
      const { title, image } = this.displayFor(c, members);

      items.push({
        id: c.id,
        kind: c.kind,
        scopeId: c.scopeId,
        title,
        image,
        members,
        lastMessage: last
          ? {
              preview: this.previewOf(last),
              createdAt: last.createdAt.toISOString(),
              authorId: last.authorId,
              authorName: last.author
                ? `${last.author.firstname} ${last.author.lastname}`.trim()
                : null,
            }
          : null,
        unreadCount,
        muted: !!mutedUntil && mutedUntil.getTime() > now,
        updatedAt: (last?.createdAt ?? c.createdAt).toISOString(),
      });
    }

    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  }

  /**
   * IDs of every conversation the viewer can access. Used to scope realtime
   * subscribe tokens to exactly the channels they're allowed to listen on.
   */
  async listConversationIds(viewerId: number): Promise<string[]> {
    const candidates = await this.gatherCandidates(viewerId);
    return candidates.map((c) => c.id);
  }

  /** Total unread across every conversation — drives the nav badge. */
  async unreadTotal(viewerId: number): Promise<number> {
    const candidates = await this.gatherCandidates(viewerId);
    if (candidates.length === 0) return 0;

    const stateMap = await this.readStateMap(
      viewerId,
      candidates.map((c) => c.id)
    );
    const counts = await Promise.all(
      candidates.map((c) =>
        this.countUnread(c.id, viewerId, c.kind, stateMap.get(c.id)?.lastReadAt ?? null)
      )
    );
    return counts.reduce((sum, n) => sum + n, 0);
  }

  // -- internals --

  /**
   * Unread count for one conversation. When the viewer has no read marker:
   *   - DM   → count everything (a fresh DM with incoming messages is unread).
   *   - club/challenge → 0 (never-opened group chats shouldn't blow up the
   *     badge with their entire backlog).
   */
  private countUnread(
    conversationId: string,
    viewerId: number,
    kind: ChatScopeKind,
    lastReadAt: Date | null
  ): Promise<number> {
    if (!lastReadAt && kind !== 'dm') return Promise.resolve(0);
    return prisma.message.count({
      where: {
        conversationId,
        parentId: null,
        // System notices are ambient — keep them out of unread counts.
        kind: { not: 'system' },
        OR: [{ authorId: null }, { authorId: { not: viewerId } }],
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });
  }

  private async gatherCandidates(viewerId: number): Promise<Candidate[]> {
    const [dmRows, clubRows, challengeRows] = await Promise.all([
      prisma.conversationParticipant.findMany({
        where: { userId: viewerId, conversation: { kind: 'dm' } },
        select: { conversation: { select: { id: true, title: true, createdAt: true } } },
      }),
      prisma.clubMember.findMany({
        where: { userId: viewerId, status: 'active' },
        select: {
          club: {
            select: { id: true, name: true, conversation: { select: { id: true, createdAt: true } } },
          },
        },
      }),
      prisma.challengeParticipant.findMany({
        where: { userId: viewerId, status: 'accepted' },
        select: {
          challenge: {
            select: { id: true, name: true, conversation: { select: { id: true, createdAt: true } } },
          },
        },
      }),
    ]);

    const candidates: Candidate[] = [];
    for (const r of dmRows) {
      candidates.push({
        id: r.conversation.id,
        kind: 'dm',
        scopeId: null,
        scopeName: null,
        title: r.conversation.title,
        createdAt: r.conversation.createdAt,
      });
    }
    for (const r of clubRows) {
      const conv = r.club.conversation;
      if (!conv) continue;
      candidates.push({
        id: conv.id,
        kind: 'club',
        scopeId: r.club.id,
        scopeName: r.club.name,
        title: null,
        createdAt: conv.createdAt,
      });
    }
    for (const r of challengeRows) {
      const conv = r.challenge.conversation;
      if (!conv) continue;
      candidates.push({
        id: conv.id,
        kind: 'challenge',
        scopeId: r.challenge.id,
        scopeName: r.challenge.name,
        title: null,
        createdAt: conv.createdAt,
      });
    }
    return candidates;
  }

  private async readStateMap(
    viewerId: number,
    conversationIds: string[]
  ): Promise<Map<string, { lastReadAt: Date | null; mutedUntil: Date | null }>> {
    const rows = await prisma.conversationParticipant.findMany({
      where: { userId: viewerId, conversationId: { in: conversationIds } },
      select: { conversationId: true, lastReadAt: true, mutedUntil: true },
    });
    const map = new Map<string, { lastReadAt: Date | null; mutedUntil: Date | null }>();
    for (const r of rows) {
      map.set(r.conversationId, { lastReadAt: r.lastReadAt, mutedUntil: r.mutedUntil });
    }
    return map;
  }

  private async dmMembersMap(
    viewerId: number,
    dmConversationIds: string[]
  ): Promise<Map<string, ChatUserSummary[]>> {
    const map = new Map<string, ChatUserSummary[]>();
    if (dmConversationIds.length === 0) return map;
    const rows = await prisma.conversationParticipant.findMany({
      where: { conversationId: { in: dmConversationIds }, userId: { not: viewerId } },
      select: { conversationId: true, user: { select: userSummarySelect } },
      orderBy: { joinedAt: 'asc' },
    });
    for (const r of rows) {
      const list = map.get(r.conversationId) ?? [];
      list.push(r.user);
      map.set(r.conversationId, list);
    }
    return map;
  }

  private displayFor(
    c: Candidate,
    members: ChatUserSummary[]
  ): { title: string; image: string | null } {
    if (c.kind !== 'dm') {
      return { title: c.scopeName ?? '', image: null };
    }
    if (c.title) {
      return { title: c.title, image: null };
    }
    if (members.length === 1) {
      const m = members[0];
      return { title: `${m.firstname} ${m.lastname}`.trim(), image: m.profile };
    }
    return { title: this.composeGroupName(members), image: null };
  }

  private composeGroupName(members: ChatUserSummary[]): string {
    const names = members.map((m) => m.firstname).filter(Boolean);
    if (names.length === 0) return 'Group';
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }

  private previewOf(last: {
    kind: string;
    body: string | null;
    payload: Prisma.JsonValue;
  }): string {
    if (last.kind === 'text' && last.body) {
      return truncatePreview(last.body);
    }
    if (last.kind === 'activity_digest') {
      const payload = last.payload as DigestPayload | null;
      return `Activity recap (${payload?.activities?.length ?? 0})`;
    }
    if (last.kind === 'system' && last.body) {
      return truncatePreview(last.body);
    }
    return '…';
  }

  /** Append a system notice (joined/left/created) to a conversation. */
  private async postSystemMessage(
    conversationId: string,
    payload: SystemPayload,
    bodyFallback: string
  ): Promise<void> {
    await prisma.message.create({
      data: {
        conversationId,
        authorId: null,
        kind: 'system',
        body: bodyFallback,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    // Surface join/left/created notices live in any open thread.
    void realtimePublisher.publishToConversation(conversationId);
  }

  private async userName(userId: number): Promise<string> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstname: true, lastname: true },
    });
    return u ? `${u.firstname} ${u.lastname}`.trim() : 'Someone';
  }

  /**
   * Load a group DM and the actor's role, asserting the conversation is a group
   * (kind='dm' with no `dmKey` — 1:1 DMs and scoped conversations are rejected)
   * and that the actor is a participant.
   */
  private async loadGroupForActor(
    conversationId: string,
    actorId: number
  ): Promise<{ role: string }> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, kind: true, dmKey: true },
    });
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    if (conversation.kind !== 'dm' || conversation.dmKey) {
      throw new Error('Not a group conversation');
    }
    const actor = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: actorId } },
      select: { role: true },
    });
    if (!actor) {
      throw new Error('FORBIDDEN: not a group participant');
    }
    return { role: actor.role };
  }

  /** Promote the earliest-joined member to owner if the group has none. */
  private async ensureOwner(conversationId: string): Promise<void> {
    const owner = await prisma.conversationParticipant.findFirst({
      where: { conversationId, role: 'owner' },
      select: { id: true },
    });
    if (owner) return;
    const next = await prisma.conversationParticipant.findFirst({
      where: { conversationId },
      orderBy: { joinedAt: 'asc' },
      select: { id: true },
    });
    if (next) {
      await prisma.conversationParticipant.update({
        where: { id: next.id },
        data: { role: 'owner' },
      });
    }
  }

  private async assertFriends(actorId: number, userIds: number[]): Promise<void> {
    if (userIds.length === 0) return;
    const friendIds = new Set(await this.friendsService.listFriendIds(actorId));
    const strangers = userIds.filter((id) => !friendIds.has(id));
    if (strangers.length > 0) {
      throw new Error('You can only message friends');
    }
  }
}

export const conversationsService = new ConversationsService();

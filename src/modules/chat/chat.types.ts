import type { ChatScopeKind } from '../inbox/inbox.types.js';

export type { ChatScopeKind };

/** Sender/contributor summary embedded in messages and digest activities. */
export interface ChatUserSummary {
  id: number;
  firstname: string;
  lastname: string;
  profile: string;
  profileMedium: string;
}

export interface ConversationSummary {
  id: string;
  kind: ChatScopeKind;
  scopeName: string;
  /** Only set when kind='club' or kind='challenge'. */
  scopeId: string | null;
  /**
   * Representative avatar: the other person's profile for a 1:1 DM, null for
   * group DMs, clubs and challenges (those render an icon/initials instead).
   */
  image: string | null;
}

/** Last-message preview embedded in a conversation list row. */
export interface ConversationLastMessage {
  preview: string;
  createdAt: string;
  /** Null for activity_digest / system messages. */
  authorId: number | null;
  authorName: string | null;
}

/**
 * One row in the unified Messages inbox. Unlike `ConversationSummary` (the
 * lightweight resolve result), this carries everything the inbox list needs:
 * display title/avatar, the other members (DMs/groups), last-message preview,
 * unread count and mute state.
 */
export interface ConversationListItem {
  id: string;
  kind: ChatScopeKind;
  scopeId: string | null;
  /** Display name: other user (1:1), group title/composed names, or club/challenge name. */
  title: string;
  image: string | null;
  /** Other participants for DMs/groups (excludes the viewer). Empty for clubs/challenges. */
  members: ChatUserSummary[];
  lastMessage: ConversationLastMessage | null;
  unreadCount: number;
  muted: boolean;
  /** Sort key — last message time, or conversation creation time when empty. */
  updatedAt: string;
}

export interface ReactionSummary {
  emoji: string;
  /** User IDs that reacted with this emoji, in insertion order. */
  userIds: number[];
  /** True if the requesting viewer is among `userIds`. */
  viewerReacted: boolean;
}

/** One activity inside an `activity_digest` payload. */
export interface DigestActivity {
  userId: number;
  activityId: string;
  type: string;
  name: string;
  distance: number;
  movingTime: number;
  elevation: number;
  /** ISO date — useful when the digest spans an edited late entry. */
  recordedAt: string;
}

export interface DigestPayload {
  /** YYYY-MM-DD in the user's local-date sense — see activity-digest.service. */
  date: string;
  activities: DigestActivity[];
}

export type MessageKind = 'text' | 'activity_digest' | 'system';

/** Membership/lifecycle events rendered as a centered notice in the thread. */
export type SystemEvent = 'club_created' | 'member_joined' | 'member_left';

export interface SystemPayload {
  event: SystemEvent;
  /** The user the event is about (joined/left/created). */
  userId?: number;
  /** Display name, denormalised at write time so the client needn't resolve it. */
  actorName?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  kind: MessageKind;
  /** Null for `activity_digest` and `system` messages. */
  author: ChatUserSummary | null;
  /** Null for non-text messages. */
  body: string | null;
  /** Set when kind='activity_digest'. */
  digest: DigestPayload | null;
  /** Set when kind='system'. */
  system: SystemPayload | null;
  /** Parent message id when this is a reply. */
  parentId: string | null;
  /** Resolved user IDs of @-mentions, in source order. Empty for non-text. */
  mentions: number[];
  reactions: ReactionSummary[];
  replyCount: number;
  createdAt: string;
  editedAt: string | null;
}

export interface ChatPage {
  messages: ChatMessage[];
  /** ID to pass back as `?cursor=` for the next (older) page. Null when at the end. */
  nextCursor: string | null;
}

export interface MuteState {
  /** ISO date when the mute expires, or null if not muted. */
  mutedUntil: string | null;
}

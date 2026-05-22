import { prisma } from '@shared/utils/index.js';
import { privacyService } from '../privacy/index.js';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

const actorSelect = {
  id: true,
  firstname: true,
  lastname: true,
  profile: true,
  profileMedium: true,
} as const;

export interface HydratedNotification {
  id: string;
  type: string;
  actorId: number | null;
  actor: {
    id: number;
    firstname: string;
    lastname: string;
    profile: string;
    profileMedium: string;
  } | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface InboxPage {
  notifications: HydratedNotification[];
  nextCursor: string | null;
}

export class InboxService {
  /**
   * Return a page of the viewer's notifications, newest first.
   * Cursor-paginated on `id` (BigInt). Pass last id back as ?cursor=<id>.
   */
  async list(userId: number, cursor?: string, limit = PAGE_SIZE_DEFAULT): Promise<InboxPage> {
    const clamped = Math.min(Math.max(limit, 1), PAGE_SIZE_MAX);
    let cursorBigInt: bigint | undefined;
    if (cursor) {
      try {
        cursorBigInt = BigInt(cursor);
      } catch {
        throw new Error('Invalid cursor');
      }
    }

    // Hide notifications whose actor the viewer has since blocked (or who has
    // blocked the viewer). Mute does NOT apply — direct notifications survive
    // mute; only the feed and leaderboards are muted.
    const blocked = await privacyService.getHiddenIds(userId, { includeMutes: false });

    const rows = await prisma.notification.findMany({
      where: {
        userId,
        ...(blocked.size > 0
          ? { OR: [{ actorId: null }, { actorId: { notIn: [...blocked] } }] }
          : {}),
        ...(cursorBigInt !== undefined ? { id: { lt: cursorBigInt } } : {}),
      },
      include: { actor: { select: actorSelect } },
      orderBy: [{ id: 'desc' }],
      take: clamped + 1,
    });

    const hasMore = rows.length > clamped;
    const page = hasMore ? rows.slice(0, clamped) : rows;

    const notifications: HydratedNotification[] = page.map((row) => ({
      id: row.id.toString(),
      type: row.type,
      actorId: row.actorId,
      actor: row.actor,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));

    return {
      notifications,
      nextCursor: hasMore ? notifications[notifications.length - 1].id : null,
    };
  }

  /**
   * Unread count — drives the bubble in `useTabBadges`.
   */
  async unreadCount(userId: number): Promise<number> {
    const blocked = await privacyService.getHiddenIds(userId, { includeMutes: false });
    return prisma.notification.count({
      where: {
        userId,
        readAt: null,
        ...(blocked.size > 0
          ? { OR: [{ actorId: null }, { actorId: { notIn: [...blocked] } }] }
          : {}),
      },
    });
  }

  async markRead(userId: number, notificationId: string): Promise<void> {
    let id: bigint;
    try {
      id = BigInt(notificationId);
    } catch {
      throw new Error('Invalid notification id');
    }
    const row = await prisma.notification.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!row || row.userId !== userId) {
      throw new Error('Notification not found');
    }
    await prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: number): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async deleteOne(userId: number, notificationId: string): Promise<void> {
    let id: bigint;
    try {
      id = BigInt(notificationId);
    } catch {
      throw new Error('Invalid notification id');
    }
    const row = await prisma.notification.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!row || row.userId !== userId) {
      throw new Error('Notification not found');
    }
    await prisma.notification.delete({ where: { id } });
  }

  async deleteAll(userId: number): Promise<number> {
    const result = await prisma.notification.deleteMany({
      where: { userId },
    });
    return result.count;
  }
}

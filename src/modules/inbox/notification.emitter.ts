import { prisma } from '@shared/utils/index.js';
import type { NotificationPayload } from './inbox.types.js';

/**
 * Single chokepoint for inserting Notification rows (A1 pattern, mirrors
 * `feedEventEmitter`). Every code path that needs to drop something in the
 * user's inbox goes through here — that gives us one place to add cross-cutting
 * concerns later (push fan-out, debounce, batching).
 */
class NotificationEmitter {
  /**
   * Insert a single notification.
   *
   * `userId` is the RECIPIENT (the person who'll see this in their inbox).
   * `actorId` is OPTIONAL and identifies who caused the event (omit for
   * system-driven notifications like achievement unlocks).
   */
  async record(
    userId: number,
    payload: NotificationPayload,
    options?: { actorId?: number }
  ): Promise<void> {
    await prisma.notification.create({
      data: {
        userId,
        type: payload.type,
        actorId: options?.actorId ?? null,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: payload.metadata as unknown as object,
      },
    });
  }
}

export const notificationEmitter = new NotificationEmitter();

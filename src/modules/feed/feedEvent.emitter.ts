import { prisma } from '@shared/utils/index.js';
import type { FeedEventPayload, FeedEventType } from './feed.types.js';

/**
 * Single chokepoint for inserting FeedEvent rows.
 *
 * Every code path that wants to "emit" a feed event (activities sync, PR job,
 * challenges service, achievements service, seed scripts) calls
 * `feedEventEmitter.record(...)`. Adding a new event type is mechanical: extend
 * the FeedEventPayload union in feed.types.ts, then call `record` from the
 * producing code with that shape.
 *
 * Never insert directly into the FeedEvent table — go through this emitter so
 * we have one place to add cross-cutting behaviour later (debounce, batching,
 * push notification fan-out, etc.).
 */
class FeedEventEmitter {
  /**
   * Insert a single feed event. Returns the created row.
   */
  async record(actorId: number, payload: FeedEventPayload, createdAt?: Date): Promise<void> {
    await prisma.feedEvent.create({
      data: {
        actorId,
        type: payload.type,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: payload.metadata as unknown as object,
        ...(createdAt ? { createdAt } : {}),
      },
    });
  }

  /**
   * Bulk insert variant. Use during sync or seed where you have many events.
   */
  async recordMany(
    events: Array<{ actorId: number; payload: FeedEventPayload; createdAt?: Date }>
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    await prisma.feedEvent.createMany({
      data: events.map(({ actorId, payload, createdAt }) => ({
        actorId,
        type: payload.type,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: payload.metadata as unknown as object,
        ...(createdAt ? { createdAt } : {}),
      })),
    });
  }

  /**
   * Remove all events of a given type for an actor — useful for resetting
   * state when re-seeding test data idempotently.
   */
  async deleteByActorAndType(actorId: number, types: FeedEventType[]): Promise<void> {
    await prisma.feedEvent.deleteMany({
      where: { actorId, type: { in: types } },
    });
  }
}

export const feedEventEmitter = new FeedEventEmitter();

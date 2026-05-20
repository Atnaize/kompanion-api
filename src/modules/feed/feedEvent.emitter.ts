import { prisma } from '@shared/utils/index.js';
import type { FeedEventPayload, FeedEventType, PhotoAddedMetadata } from './feed.types.js';

/**
 * Bursts of the same `photo_added` event on the same activity get collapsed
 * into one row if they land within this window. Strava webhooks fire one
 * event per photo upload — without debouncing, uploading 5 photos to a ride
 * produces 5 near-identical cards. With it, the existing card's count grows.
 *
 * 1h is wide enough to cover a "uploading from the ride file" burst but
 * narrow enough that a separate later upload session shows as its own card.
 */
const PHOTO_ADDED_DEBOUNCE_MS = 60 * 60 * 1000;

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
   *
   * `photo_added` is special-cased: if an existing row for the same actor +
   * activity exists within the debounce window, we increment its count
   * instead of creating a duplicate (see {@link PHOTO_ADDED_DEBOUNCE_MS}).
   * We deliberately do NOT bump the original `createdAt` — the card stays in
   * its feed position rather than jumping to the top with every photo upload.
   */
  async record(actorId: number, payload: FeedEventPayload, createdAt?: Date): Promise<void> {
    if (payload.type === 'photo_added' && !createdAt) {
      const merged = await this.tryMergePhotoAdded(actorId, payload.entityId, payload.metadata);
      if (merged) return;
    }

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
   * If a recent `photo_added` row exists for this actor + activity, fold the
   * new delta into it and return true. Otherwise return false so the caller
   * inserts a fresh row.
   *
   * Skipped when the caller passed an explicit `createdAt` (seed scripts,
   * backfills) — that path wants exact timestamps, not merged ones.
   */
  private async tryMergePhotoAdded(
    actorId: number,
    entityId: string,
    incoming: PhotoAddedMetadata
  ): Promise<boolean> {
    const since = new Date(Date.now() - PHOTO_ADDED_DEBOUNCE_MS);
    const existing = await prisma.feedEvent.findFirst({
      where: {
        actorId,
        type: 'photo_added',
        entityId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, metadata: true },
    });
    if (!existing) return false;

    const prevCount =
      typeof (existing.metadata as { count?: unknown } | null)?.count === 'number'
        ? (existing.metadata as { count: number }).count
        : 0;
    const nextCount = prevCount + incoming.count;

    await prisma.feedEvent.update({
      where: { id: existing.id },
      data: { metadata: { count: nextCount } as unknown as object },
    });
    return true;
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

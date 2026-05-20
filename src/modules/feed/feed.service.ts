import crypto from 'crypto';
import { prisma, tryClaimRun, recordRunResult } from '@shared/utils/index.js';
import { logger } from '@shared/logger/index.js';
import { FriendsService } from '../friends/friends.service.js';
import type { ActivityPostedMetadata } from './feed.types.js';

const FEED_PAGE_SIZE_DEFAULT = 20;
const FEED_PAGE_SIZE_MAX = 50;

// Stat-compare matching window (R3). Tunable.
const COMPARE_WINDOW_DAYS = 90;
const COMPARE_DISTANCE_TOLERANCE = 0.15; // ±15%

// Retention window. Anything older is hard-deleted by the periodic purge.
// FeedEvent is a denormalised view — old rows can be re-derived from the
// underlying Activity / PersonalRecord / UserAchievement tables if ever needed.
const FEED_RETENTION_DAYS = 90;
const FEED_RETENTION_JOB_NAME = 'feed_event_retention';
const FEED_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

const actorSelect = {
  id: true,
  firstname: true,
  lastname: true,
  profile: true,
  profileMedium: true,
} as const;

/**
 * Viewer-relative annotation attached to certain feed events (currently just
 * `activity_posted`). Tells the frontend "you have a comparable activity in
 * your own history — here's how the friend's effort stacks up."
 *
 * Computed at hydration time, never persisted (different viewers see different
 * compares against the same event).
 */
export interface FeedEventCompare {
  yourBest: {
    activityId: string;
    name: string;
    distance: number; // meters
    movingTime: number; // seconds
    averageSpeed: number; // m/s
    startDate: string; // ISO
  };
  /**
   * Friend's pace minus yours, in seconds-per-km.
   * Positive ⇒ friend was slower; negative ⇒ friend was faster.
   */
  paceDeltaSecondsPerKm: number;
}

/**
 * Snapshot of an Activity row attached to `activity_posted` events at
 * hydration time. Fresher than the event's `metadata` (kudos count grows over
 * time after the event was emitted), and gives the frontend everything it
 * needs to render a rich card without an extra round-trip.
 */
export interface FeedActivityPhoto {
  /** Pre-picked best-fit URL — frontend doesn't need to choose a size. */
  url: string;
  caption: string | null;
}

export interface FeedActivitySnapshot {
  id: string;
  kudosCount: number;
  commentCount: number;
  photoCount: number;
  prCount: number;
  averageHeartrate: number | null;
  summaryPolyline: string | null;
  /** Up to 4 photo thumbnails for inline rendering. */
  photos: FeedActivityPhoto[];
}

export interface HydratedFeedEvent {
  id: string; // BigInt serialised as string to keep the wire JSON-safe
  /** Discriminator — see FeedEventType for known values; frontend narrows. */
  type: string;
  actorId: number;
  actor: {
    id: number;
    firstname: string;
    lastname: string;
    profile: string;
    profileMedium: string;
  };
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string; // ISO
  /** Present only when the viewer has a comparable activity (see R3). */
  compare?: FeedEventCompare;
  /** Present on `activity_posted` events when the underlying activity is found. */
  activity?: FeedActivitySnapshot;
}

export interface FeedPage {
  events: HydratedFeedEvent[];
  nextCursor: string | null;
}

interface ViewerActivity {
  id: bigint;
  name: string;
  type: string;
  distance: number;
  movingTime: number;
  averageSpeed: number;
  startDate: Date;
}

export class FeedService {
  private friendsService = new FriendsService();

  /**
   * Return a page of feed events for the viewer. Events are filtered to the
   * viewer's friend graph (mutual accepted) and ordered by **event date**
   * (newest first) — NOT by row id, which would expose insertion order.
   *
   * Pagination: composite keyset cursor `<createdAtMillis>_<id>` so it stays
   * consistent across pages even when two events share a `createdAt`.
   *
   * Hydration includes per-event `compare` and `activity` snapshots — each
   * adds one batched query per page, regardless of page size.
   */
  async getFeed(
    viewerId: number,
    cursor?: string,
    limit = FEED_PAGE_SIZE_DEFAULT,
    since?: Date
  ): Promise<FeedPage> {
    const clampedLimit = Math.min(Math.max(limit, 1), FEED_PAGE_SIZE_MAX);
    const friendIds = await this.friendsService.listFriendIds(viewerId);

    // Fire-and-forget retention sweep. `tryClaimRun` short-circuits ~all calls
    // (one cheap UPDATE), so this is effectively free except once per 24h.
    this.purgeOldEvents().catch((err) => {
      logger.error({ err }, '[Feed] retention sweep failed');
    });

    if (friendIds.length === 0) {
      return { events: [], nextCursor: null };
    }

    const cursorParsed = parseCursor(cursor);

    // Composite keyset: `(createdAt, id) < (cursorCreatedAt, cursorId)` in DESC ordering.
    // The OR-clause expresses the tie-break: same createdAt → use id to break.
    const cursorWhere = cursorParsed
      ? {
          OR: [
            { createdAt: { lt: cursorParsed.createdAt } },
            { createdAt: cursorParsed.createdAt, id: { lt: cursorParsed.id } },
          ],
        }
      : {};

    // `?since=<ISO>` is the incremental-polling case (tab open at top of feed).
    // Combines cleanly with cursorWhere when both are passed (rare but valid).
    const sinceWhere = since ? { createdAt: { gt: since } } : {};

    // Fetch one extra row to know whether there's a next page.
    const rows = await prisma.feedEvent.findMany({
      where: {
        actorId: { in: friendIds },
        ...cursorWhere,
        ...sinceWhere,
      },
      include: { actor: { select: actorSelect } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: clampedLimit + 1,
    });

    const hasMore = rows.length > clampedLimit;
    const page = hasMore ? rows.slice(0, clampedLimit) : rows;

    const events: HydratedFeedEvent[] = page.map((row) => ({
      id: row.id.toString(),
      type: row.type,
      actorId: row.actorId,
      actor: row.actor,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    await this.attachActivitySnapshots(events);
    await this.attachCompareBlocks(viewerId, events);

    const nextCursor = hasMore
      ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
      : null;
    return { events, nextCursor };
  }

  /**
   * For every `activity_posted` event, hydrate `event.activity` with a fresh
   * snapshot of the underlying Activity row (kudos/photo/PR counts, polyline,
   * heart rate). ONE batched query for the whole page.
   *
   * Why fresh data? `metadata` is frozen at emit time; kudos/photo counts grow
   * after that. The frontend always gets current numbers.
   */
  private async attachActivitySnapshots(events: HydratedFeedEvent[]): Promise<void> {
    const activityIds: bigint[] = [];
    for (const e of events) {
      if (e.type === 'activity_posted' && e.entityId) {
        try {
          activityIds.push(BigInt(e.entityId));
        } catch {
          // Skip malformed ids — defensive, shouldn't happen.
        }
      }
    }
    if (activityIds.length === 0) {
      return;
    }

    const rows = await prisma.activity.findMany({
      where: { id: { in: activityIds } },
      select: {
        id: true,
        kudosCount: true,
        commentCount: true,
        photoCount: true,
        prCount: true,
        averageHeartrate: true,
        summaryPolyline: true,
      },
    });

    // Batched photo fetch (up to 4 per activity).
    const photosByActivityId = new Map<string, FeedActivityPhoto[]>();
    const idsWithPhotos = rows.filter((r) => r.photoCount > 0).map((r) => r.id);
    if (idsWithPhotos.length > 0) {
      const photoRows = await prisma.activityPhoto.findMany({
        where: { activityId: { in: idsWithPhotos } },
        orderBy: [{ defaultPhoto: 'desc' }, { takenAt: 'asc' }],
      });
      for (const photo of photoRows) {
        const key = photo.activityId.toString();
        const list = photosByActivityId.get(key) ?? [];
        if (list.length >= 4) continue; // cap at 4
        list.push({
          url: pickBestPhotoUrl(photo.urls),
          caption: photo.caption,
        });
        photosByActivityId.set(key, list);
      }
    }

    const byId = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      byId.set(row.id.toString(), row);
    }

    for (const event of events) {
      if (event.type !== 'activity_posted' || !event.entityId) continue;
      const row = byId.get(event.entityId);
      if (!row) continue;
      event.activity = {
        id: row.id.toString(),
        kudosCount: row.kudosCount,
        commentCount: row.commentCount,
        photoCount: row.photoCount,
        prCount: row.prCount,
        averageHeartrate: row.averageHeartrate,
        summaryPolyline: row.summaryPolyline,
        photos: photosByActivityId.get(event.entityId) ?? [],
      };
    }
  }

  /**
   * For every `activity_posted` event in `events`, attach `compare` if the
   * viewer has a similar recent activity. ONE extra DB query per page (we
   * pull the viewer's recent activities once, then match in memory).
   *
   * "Similar" means: same activity `type`, distance within ±15%, within the
   * last 90 days. Match heuristic is R3 — tune by hand as we gather feedback.
   */
  private async attachCompareBlocks(viewerId: number, events: HydratedFeedEvent[]): Promise<void> {
    const activityEvents = events.filter((e) => e.type === 'activity_posted');
    if (activityEvents.length === 0) {
      return;
    }

    const since = new Date(Date.now() - COMPARE_WINDOW_DAYS * 86_400_000);
    const viewerActivities = await prisma.activity.findMany({
      where: { userId: viewerId, startDate: { gte: since } },
      select: {
        id: true,
        name: true,
        type: true,
        distance: true,
        movingTime: true,
        averageSpeed: true,
        startDate: true,
      },
    });
    if (viewerActivities.length === 0) {
      return;
    }

    for (const event of activityEvents) {
      const meta = event.metadata as unknown as ActivityPostedMetadata | null;
      if (!meta) continue;
      const best = pickBestMatch(viewerActivities, meta);
      if (!best) continue;
      event.compare = buildCompare(meta, best);
    }
  }

  /**
   * Cheap signature used by the controller to answer conditional GETs.
   *
   * Hashes `(viewerId, friendSet, latestFriendEvent)` so the ETag flips when
   * any of those change. One small query (`findFirst` on the indexed
   * `(actorId, createdAt)` path) — runs in front of the heavy feed query
   * specifically so we can short-circuit to 304 before hydrating.
   */
  async computeSignature(viewerId: number): Promise<{ etag: string; hasFriends: boolean }> {
    const friendIds = await this.friendsService.listFriendIds(viewerId);
    if (friendIds.length === 0) {
      const raw = `v1:${viewerId}:nofriends`;
      return { etag: weakEtag(raw), hasFriends: false };
    }

    const latest = await prisma.feedEvent.findFirst({
      where: { actorId: { in: friendIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, createdAt: true },
    });

    const friendsHash = crypto
      .createHash('md5')
      .update([...friendIds].sort((a, b) => a - b).join(','))
      .digest('hex')
      .slice(0, 8);

    const latestPart = latest ? `${latest.createdAt.getTime()}_${latest.id.toString()}` : 'empty';
    const raw = `v1:${viewerId}:${friendsHash}:${latestPart}`;
    return { etag: weakEtag(raw), hasFriends: true };
  }

  /**
   * Delete FeedEvent rows older than {@link FEED_RETENTION_DAYS}.
   *
   * Lazy-scheduled: called from `getFeed` on every request, but
   * {@link tryClaimRun} ensures the actual `deleteMany` runs at most once per
   * 24h across the fleet (Postgres-level guard, safe across serverless cold
   * starts and concurrent invocations).
   *
   * Older feed events can be re-derived from the underlying Activity /
   * PersonalRecord / UserAchievement tables if we ever need them again, so
   * hard-delete is fine — FeedEvent is a denormalised view, not a source.
   */
  async purgeOldEvents(options?: { force?: boolean }): Promise<number> {
    if (!options?.force) {
      const claimed = await tryClaimRun(FEED_RETENTION_JOB_NAME, FEED_RETENTION_INTERVAL_MS);
      if (!claimed) return 0;
    }

    const cutoff = new Date(Date.now() - FEED_RETENTION_DAYS * 86_400_000);

    try {
      const result = await prisma.feedEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      await recordRunResult(FEED_RETENTION_JOB_NAME, 'ok');
      if (result.count > 0) {
        logger.info(
          { deleted: result.count, cutoff: cutoff.toISOString() },
          '[Feed] purged old events'
        );
      }
      return result.count;
    } catch (err) {
      await recordRunResult(FEED_RETENTION_JOB_NAME, 'error');
      logger.error({ err }, '[Feed] purgeOldEvents failed');
      throw err;
    }
  }
}

/**
 * Weak ETag — the body is dynamically hydrated so byte-equality isn't
 * guaranteed even for "same logical state". Weak validators are explicitly
 * allowed by HTTP spec for this kind of semantic-equivalence comparison.
 */
function weakEtag(raw: string): string {
  const hash = crypto.createHash('md5').update(raw).digest('hex');
  return `W/"${hash}"`;
}

function pickBestMatch(
  viewerActivities: ViewerActivity[],
  meta: ActivityPostedMetadata
): ViewerActivity | null {
  const tolerance = meta.distance * COMPARE_DISTANCE_TOLERANCE;
  const matches = viewerActivities.filter(
    (v) => v.type === meta.type && Math.abs(v.distance - meta.distance) <= tolerance
  );
  if (matches.length === 0) {
    return null;
  }
  // Best = fastest (highest averageSpeed) — that's the most ambitious comparable.
  return matches.reduce((b, m) => (m.averageSpeed > b.averageSpeed ? m : b));
}

/**
 * Encode a composite cursor `<createdAtMillis>_<id>`. Kept as a single string
 * so the wire format is opaque to clients.
 */
function encodeCursor(createdAt: Date, id: bigint): string {
  return `${createdAt.getTime()}_${id.toString()}`;
}

interface ParsedCursor {
  createdAt: Date;
  id: bigint;
}

function parseCursor(cursor: string | undefined): ParsedCursor | null {
  if (!cursor) return null;
  const sep = cursor.indexOf('_');
  if (sep === -1) {
    throw new Error('Invalid cursor');
  }
  const millis = Number(cursor.slice(0, sep));
  if (!Number.isFinite(millis)) throw new Error('Invalid cursor');
  let id: bigint;
  try {
    id = BigInt(cursor.slice(sep + 1));
  } catch {
    throw new Error('Invalid cursor');
  }
  return { createdAt: new Date(millis), id };
}

/**
 * Strava photo URLs are keyed by max-pixel size (`"100" | "600" | "2048"`).
 * Pick the closest match to ~600px (good balance of quality and bandwidth for
 * a feed thumbnail). Falls back to whatever is available.
 */
function pickBestPhotoUrl(urls: unknown): string {
  if (!urls || typeof urls !== 'object') return '';
  const entries = Object.entries(urls as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === 'string'
  );
  if (entries.length === 0) return '';
  const target = 600;
  let best = entries[0];
  let bestDelta = Math.abs(Number(best[0]) - target);
  for (const entry of entries.slice(1)) {
    const delta = Math.abs(Number(entry[0]) - target);
    if (delta < bestDelta) {
      best = entry;
      bestDelta = delta;
    }
  }
  return best[1];
}

function buildCompare(meta: ActivityPostedMetadata, best: ViewerActivity): FeedEventCompare {
  const friendPace = 1000 / meta.averageSpeed;
  const viewerPace = 1000 / best.averageSpeed;
  return {
    yourBest: {
      activityId: best.id.toString(),
      name: best.name,
      distance: best.distance,
      movingTime: best.movingTime,
      averageSpeed: best.averageSpeed,
      startDate: best.startDate.toISOString(),
    },
    paceDeltaSecondsPerKm: friendPace - viewerPace,
  };
}

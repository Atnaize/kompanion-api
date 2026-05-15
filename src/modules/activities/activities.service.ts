import axios from 'axios';
import { config } from '@config/env.js';
import { parseRateLimitHeaders, prisma, throwIfRateLimited } from '@shared/utils/index.js';
import { AuthService } from '../auth/auth.service.js';
import { ChallengeService } from '../challenges/challenge.service.js';
import { FriendsService } from '../friends/friends.service.js';
import { PersonalRecordsService } from '../personal-records/personal-records.service.js';
import { feedEventEmitter } from '../feed/index.js';
import type {
  StravaActivity,
  StravaComment,
  StravaDetailedActivity,
  StravaLap,
  StravaPhoto,
  StravaStreamSet,
  StravaStreamType,
  StravaSummaryAthlete,
  User,
} from '@shared/types/index.js';
import { AppError } from '@shared/middleware/index.js';
import { HttpStatus } from '@shared/types/index.js';

// Stable, positive 32-bit-ish int hash of a string. Used as a React-key
// fallback when Strava returns kudoers without athlete ids.
const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

export class ActivitiesService {
  private authService = new AuthService();
  private challengeService = new ChallengeService();
  private friendsService = new FriendsService();
  private personalRecordsService = new PersonalRecordsService();

  /**
   * Resolve an activity for a read request. Returns the row + the User who
   * owns it (needed to drive Strava API calls with the correct token).
   *
   * Returns null when the activity doesn't exist OR the viewer can't see it
   * (not the owner and not a mutual friend). We collapse both cases to null
   * on purpose — non-friends should see "not found" rather than "forbidden",
   * matching the privacy model used for profile stats.
   */
  private async resolveActivityForRead(
    activityId: number,
    viewer: User
  ) {
    const dbActivity = await prisma.activity.findUnique({
      where: { id: BigInt(activityId) },
    });
    if (!dbActivity) return null;
    if (dbActivity.userId === viewer.id) {
      return { dbActivity, owner: viewer };
    }
    try {
      await this.friendsService.assertFriendsOrSelf(viewer.id, dbActivity.userId);
    } catch {
      return null;
    }
    const owner = await this.authService.getUserById(dbActivity.userId);
    if (!owner) return null;
    return { dbActivity, owner };
  }

  async fetchActivities(
    user: User,
    page = 1,
    perPage = 30,
    after?: number
  ): Promise<StravaActivity[]> {
    try {
      console.info('[Fetch] Ensuring valid token for user:', user.id);
      const accessToken = await this.authService.ensureValidToken(user);
      console.info('[Fetch] Token ready, fetching activities page:', page);

      const params: Record<string, string | number> = {
        page,
        per_page: perPage,
      };

      if (after) {
        params.after = after;
      }

      const response = await axios.get<StravaActivity[]>(
        `${config.strava.apiUrl}/athlete/activities`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params,
        }
      );

      await this.personalRecordsService.recordUsage(user.id, 'activity_sync');

      const usage = parseRateLimitHeaders(response.headers);
      console.info(
        '[Fetch] Got',
        response.data.length,
        'activities from Strava',
        usage
          ? `(Strava limit: ${usage.used15min}/${usage.limit15min} 15min, ${usage.usedDay}/${usage.limitDay} day)`
          : ''
      );
      return response.data;
    } catch (error) {
      throwIfRateLimited(error);
      console.error(
        '[Fetch] Error fetching activities:',
        error instanceof Error ? error.message : error
      );
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(HttpStatus.BAD_REQUEST, 'Failed to fetch activities from Strava');
    }
  }

  async syncActivities(user: User): Promise<{
    synced: number;
    total: number;
    isIncremental: boolean;
    challengesSynced: number;
    challengeActivitiesAdded: number;
  }> {
    const isIncremental = !!user.lastSyncedAt;
    const after = user.lastSyncedAt
      ? Math.floor(new Date(user.lastSyncedAt).getTime() / 1000)
      : undefined;

    let allActivities: StravaActivity[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    // Fetch all activities from Strava
    while (hasMore) {
      const activities = await this.fetchActivities(user, page, perPage, after);

      if (activities.length === 0) {
        hasMore = false;
      } else {
        allActivities = [...allActivities, ...activities];

        if (activities.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    // Get existing activity IDs for this user
    const existingActivityIds = await prisma.activity.findMany({
      where: { userId: user.id },
      select: { id: true },
    });

    const existingIds = new Set(existingActivityIds.map((a) => a.id.toString()));

    // Filter to only new activities
    const newActivities = allActivities.filter((a) => !existingIds.has(a.id.toString()));

    // Bulk insert new activities - batch processing for performance
    if (newActivities.length > 0) {
      const batchSize = 100;

      // Process in batches to avoid serverless timeout
      for (let i = 0; i < newActivities.length; i += batchSize) {
        const batch = newActivities.slice(i, i + batchSize);
        const data = batch.map((activity) => this.mapStravaActivityToDb(activity, user.id));

        // Use createMany for bulk insert (much faster than individual creates)
        await prisma.activity.createMany({
          data,
          skipDuplicates: true,
        });
      }

      // Update user's lastSyncedAt after all activities are saved
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSyncedAt: new Date() },
      });
    } else {
      // Just update lastSyncedAt even if no new activities
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSyncedAt: new Date() },
      });
    }

    // Emit FeedEvents for the newly inserted activities. Best-effort: failures
    // here must not break sync.
    if (newActivities.length > 0) {
      await this.emitActivityPostedEvents(user.id, newActivities).catch((err) =>
        console.error('[Feed] activity_posted bulk emit failed:', err)
      );
    }

    // Sync new activities to active challenges
    const challengeSync = await this.challengeService.syncActiveChallenges(user.id);

    // PR detail processing is intentionally not done here — see
    // `PersonalRecordsService.processBacklogWithProgress`.

    return {
      synced: newActivities.length,
      total: allActivities.length,
      isIncremental,
      challengesSynced: challengeSync.synced,
      challengeActivitiesAdded: challengeSync.activitiesAdded,
    };
  }

  async syncActivitiesWithProgress(
    user: User,
    onProgress: (data: {
      type: 'fetching' | 'saving' | 'processing' | 'complete' | 'error';
      current?: number;
      total?: number;
      message?: string;
    }) => void
  ): Promise<{
    synced: number;
    total: number;
    isIncremental: boolean;
    challengesSynced: number;
    challengeActivitiesAdded: number;
  }> {
    const isIncremental = !!user.lastSyncedAt;
    const after = user.lastSyncedAt
      ? Math.floor(new Date(user.lastSyncedAt).getTime() / 1000)
      : undefined;

    let allActivities: StravaActivity[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;
    let lastEmittedCount = 0;
    const emitInterval = 20;

    // Fetch with progress tracking
    while (hasMore) {
      const activities = await this.fetchActivities(user, page, perPage, after);

      if (activities.length === 0) {
        hasMore = false;
      } else {
        allActivities = [...allActivities, ...activities];

        // Emit progress every 20 activities
        while (lastEmittedCount + emitInterval <= allActivities.length) {
          lastEmittedCount += emitInterval;
          onProgress({
            type: 'fetching',
            current: lastEmittedCount,
            message: `Fetching from Strava... ${lastEmittedCount} activities found`,
          });
        }

        // Emit final count
        if (allActivities.length > lastEmittedCount) {
          onProgress({
            type: 'fetching',
            current: allActivities.length,
            message: `Fetching from Strava... ${allActivities.length} activities found`,
          });
          lastEmittedCount = allActivities.length;
        }

        if (activities.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    // Get existing activity IDs
    const existingActivityIds = await prisma.activity.findMany({
      where: { userId: user.id },
      select: { id: true },
    });

    const existingIds = new Set(existingActivityIds.map((a) => a.id.toString()));
    const newActivities = allActivities.filter((a) => !existingIds.has(a.id.toString()));

    // Save with progress tracking - batch processing for performance
    if (newActivities.length > 0) {
      const batchSize = 100;
      let saved = 0;

      // Process in batches to avoid serverless timeout
      for (let i = 0; i < newActivities.length; i += batchSize) {
        const batch = newActivities.slice(i, i + batchSize);
        const data = batch.map((activity) => this.mapStravaActivityToDb(activity, user.id));

        // Use createMany for bulk insert (much faster than individual creates)
        await prisma.activity.createMany({
          data,
          skipDuplicates: true, // Skip if activity already exists
        });

        saved += batch.length;

        onProgress({
          type: 'saving',
          current: saved,
          total: newActivities.length,
          message: `Saving activities... ${saved}/${newActivities.length}`,
        });
      }

      // Update user's lastSyncedAt after all activities are saved
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSyncedAt: new Date() },
      });
    } else {
      // Just update lastSyncedAt even if no new activities
      await prisma.user.update({
        where: { id: user.id },
        data: { lastSyncedAt: new Date() },
      });
    }

    // Emit FeedEvents for newly inserted activities (best-effort).
    if (newActivities.length > 0) {
      await this.emitActivityPostedEvents(user.id, newActivities).catch((err) =>
        console.error('[Feed] activity_posted bulk emit failed:', err)
      );
    }

    // Sync new activities to active challenges
    const challengeSync = await this.challengeService.syncActiveChallenges(user.id);

    // PR detail processing is intentionally NOT done here — see
    // `PersonalRecordsService.processBacklogWithProgress`, which the
    // /personal-records page invokes via its own SSE stream. Keeps the main
    // sync fast and bounded.

    return {
      synced: newActivities.length,
      total: allActivities.length,
      isIncremental,
      challengesSynced: challengeSync.synced,
      challengeActivitiesAdded: challengeSync.activitiesAdded,
    };
  }

  async getUserActivities(userId: number): Promise<StravaActivity[]> {
    const activities = await prisma.activity.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
    });

    return activities.map((activity) => this.mapDbActivityToStrava(activity));
  }

  async getActivityById(activityId: number, userId: number): Promise<StravaActivity | null> {
    const activity = await prisma.activity.findFirst({
      where: {
        id: BigInt(activityId),
        userId,
      },
    });

    return activity ? this.mapDbActivityToStrava(activity) : null;
  }

  async getDetailedActivityById(
    activityId: number,
    user: User
  ): Promise<StravaDetailedActivity | null> {
    const resolved = await this.resolveActivityForRead(activityId, user);
    if (!resolved) {
      return null;
    }
    const { dbActivity, owner } = resolved;

    // Fetch detailed activity from Strava API (includes segment efforts).
    // Use the OWNER's token — Strava scopes per-athlete, so the viewer's
    // token can't read a friend's activity even when the viewer has access
    // at our app's authorization layer.
    const accessToken = await this.authService.ensureValidToken(owner);

    try {
      const response = await axios.get<StravaDetailedActivity>(
        `${config.strava.apiUrl}/activities/${activityId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      // Refresh the cached counts so the engagement cache logic can detect
      // staleness. We swallow errors here because the user shouldn't see a
      // working detail page broken by a count-write failure.
      const fresh = response.data;
      try {
        await prisma.activity.update({
          where: { id: BigInt(activityId) },
          data: {
            kudosCount: fresh.kudos_count,
            commentCount: fresh.comment_count,
            photoCount: fresh.total_photo_count,
          },
        });
      } catch (writeErr) {
        console.warn(
          '[Detail] Failed to refresh cached counts (non-fatal):',
          writeErr instanceof Error ? writeErr.message : writeErr
        );
      }

      return fresh;
    } catch (error) {
      console.error('Fetch detailed activity error:', error);
      // Fall back to basic activity data if detailed fetch fails
      return this.mapDbActivityToStrava(dbActivity);
    }
  }

  async getActivityStreams(
    activityId: number,
    user: User,
    keys: StravaStreamType[] = [
      'time',
      'distance',
      'latlng',
      'altitude',
      'velocity_smooth',
      'heartrate',
      'cadence',
      'watts',
      'temp',
      'grade_smooth',
    ]
  ): Promise<StravaStreamSet | null> {
    const resolved = await this.resolveActivityForRead(activityId, user);
    if (!resolved) {
      return null;
    }

    const accessToken = await this.authService.ensureValidToken(resolved.owner);

    try {
      const response = await axios.get<StravaStreamSet>(
        `${config.strava.apiUrl}/activities/${activityId}/streams`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { keys: keys.join(','), key_by_type: true },
        }
      );
      return response.data;
    } catch (error) {
      console.error(
        '[Streams] Error fetching streams:',
        error instanceof Error ? error.message : error
      );
      return {};
    }
  }

  async getActivityLaps(activityId: number, user: User): Promise<StravaLap[] | null> {
    const resolved = await this.resolveActivityForRead(activityId, user);
    if (!resolved) {
      return null;
    }

    const accessToken = await this.authService.ensureValidToken(resolved.owner);

    try {
      const response = await axios.get<StravaLap[]>(
        `${config.strava.apiUrl}/activities/${activityId}/laps`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      return response.data;
    } catch (error) {
      console.error('[Laps] Error fetching laps:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Cache strategy for kudoers/comments/photos:
   *   - if expectedCount === 0:                  return [] (no Strava call)
   *   - if cachedCount === expectedCount:        serve from DB (no Strava call)
   *   - else:                                    fetch from Strava, replace cache
   *
   * `expectedCount` lives on the Activity row (kudosCount / commentCount /
   * photoCount). It's refreshed every time `getDetailedActivityById` runs and
   * every time we sync activities, so opening the detail page self-heals.
   */

  async getActivityKudoers(activityId: number, user: User): Promise<StravaSummaryAthlete[] | null> {
    const resolved = await this.resolveActivityForRead(activityId, user);
    if (!resolved) return null;

    const expected = resolved.dbActivity.kudosCount;
    if (expected === 0) return [];

    const cached = await prisma.activityKudoer.findMany({
      where: { activityId: BigInt(activityId) },
      orderBy: { id: 'asc' },
    });
    if (cached.length === expected) {
      return cached.map((k) => this.kudoerToStrava(k));
    }

    console.info(`[Kudos] Cache stale (cached=${cached.length}, expected=${expected}); refetching`);
    const fresh = await this.fetchKudoersFromStrava(activityId, resolved.owner);
    if (fresh === null) return cached.map((k) => this.kudoerToStrava(k));

    await prisma.activityKudoer.deleteMany({ where: { activityId: BigInt(activityId) } });
    if (fresh.length > 0) {
      await prisma.activityKudoer.createMany({
        data: fresh.map((a) => ({
          activityId: BigInt(activityId),
          athleteId: a.id ? BigInt(a.id) : null,
          firstname: a.firstname,
          lastname: a.lastname,
          profile: a.profile ?? null,
          profileMedium: a.profile_medium ?? null,
        })),
      });
    }
    // Re-read so cached and fresh paths return identical shapes (synthesized ids etc).
    const refreshed = await prisma.activityKudoer.findMany({
      where: { activityId: BigInt(activityId) },
      orderBy: { id: 'asc' },
    });
    return refreshed.map((k) => this.kudoerToStrava(k));
  }

  async getActivityComments(activityId: number, user: User): Promise<StravaComment[] | null> {
    const resolved = await this.resolveActivityForRead(activityId, user);
    if (!resolved) return null;

    const expected = resolved.dbActivity.commentCount;
    if (expected === 0) return [];

    const cached = await prisma.activityComment.findMany({
      where: { activityId: BigInt(activityId) },
      orderBy: { commentedAt: 'asc' },
    });
    if (cached.length === expected) {
      return cached.map((c) => this.commentToStrava(c, activityId));
    }

    console.info(
      `[Comments] Cache stale (cached=${cached.length}, expected=${expected}); refetching`
    );
    const fresh = await this.fetchCommentsFromStrava(activityId, resolved.owner);
    if (fresh === null) return cached.map((c) => this.commentToStrava(c, activityId));

    // Strava occasionally strips the athlete from comments (deleted / blocked /
    // privacy). Tolerate a missing athleteId rather than dropping the comment.
    // Skip only when truly required fields (id, text, created_at) are bad.
    const persistable = fresh.flatMap((c) => {
      const createdAt = c.created_at ? new Date(c.created_at) : null;
      if (
        c.id === undefined ||
        c.id === null ||
        typeof c.text !== 'string' ||
        !createdAt ||
        Number.isNaN(createdAt.getTime())
      ) {
        console.warn(`[Comments] Skipping malformed comment for activity ${activityId}:`, {
          id: c.id,
          athleteId: c.athlete?.id,
          hasText: typeof c.text === 'string',
          createdAt: c.created_at,
        });
        return [];
      }
      return [
        {
          id: BigInt(c.id),
          activityId: BigInt(activityId),
          athleteId: c.athlete?.id ? BigInt(c.athlete.id) : null,
          athleteFirstname: c.athlete?.firstname ?? null,
          athleteLastname: c.athlete?.lastname ?? null,
          athleteProfile: c.athlete?.profile ?? null,
          athleteProfileMedium: c.athlete?.profile_medium ?? null,
          text: c.text,
          commentedAt: createdAt,
        },
      ];
    });

    try {
      await prisma.activityComment.deleteMany({ where: { activityId: BigInt(activityId) } });
      if (persistable.length > 0) {
        await prisma.activityComment.createMany({
          data: persistable,
          skipDuplicates: true,
        });
      }
      const refreshed = await prisma.activityComment.findMany({
        where: { activityId: BigInt(activityId) },
        orderBy: { commentedAt: 'asc' },
      });
      return refreshed.map((c) => this.commentToStrava(c, activityId));
    } catch (error) {
      // If persist fails, still serve the freshly-fetched data so the user gets
      // their comments. The cache will retry next time.
      console.error(
        `[Comments] Failed to persist comments for activity ${activityId}:`,
        error instanceof Error ? error.stack || error.message : error
      );
      return fresh;
    }
  }

  async getActivityPhotos(activityId: number, user: User): Promise<StravaPhoto[] | null> {
    const resolved = await this.resolveActivityForRead(activityId, user);
    if (!resolved) return null;

    const expected = resolved.dbActivity.photoCount;
    if (expected === 0) return [];

    const cached = await prisma.activityPhoto.findMany({
      where: { activityId: BigInt(activityId) },
    });
    if (cached.length === expected) {
      return cached.map((p) => this.photoToStrava(p, activityId));
    }

    console.info(
      `[Photos] Cache stale (cached=${cached.length}, expected=${expected}); refetching`
    );
    const fresh = await this.fetchPhotosFromStrava(activityId, resolved.owner);
    if (fresh === null) return cached.map((p) => this.photoToStrava(p, activityId));

    await prisma.activityPhoto.deleteMany({ where: { activityId: BigInt(activityId) } });
    if (fresh.length > 0) {
      await prisma.activityPhoto.createMany({
        data: fresh.map((p) => ({
          uniqueId: p.unique_id,
          activityId: BigInt(activityId),
          caption: p.caption ?? null,
          urls: p.urls,
          defaultPhoto: !!p.default_photo,
          takenAt: p.uploaded_at ? new Date(p.uploaded_at) : null,
        })),
        skipDuplicates: true,
      });
    }
    const refreshed = await prisma.activityPhoto.findMany({
      where: { activityId: BigInt(activityId) },
    });
    return refreshed.map((p) => this.photoToStrava(p, activityId));
  }

  // ─── Strava fetch helpers (return null if rate-limited / network error) ────

  private async fetchKudoersFromStrava(
    activityId: number,
    user: User
  ): Promise<StravaSummaryAthlete[] | null> {
    const accessToken = await this.authService.ensureValidToken(user);
    try {
      const response = await axios.get<StravaSummaryAthlete[]>(
        `${config.strava.apiUrl}/activities/${activityId}/kudos`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { per_page: 100 },
        }
      );
      return response.data;
    } catch (error) {
      throwIfRateLimited(error);
      console.error(
        '[Kudos] Error fetching kudoers:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  private async fetchCommentsFromStrava(
    activityId: number,
    user: User
  ): Promise<StravaComment[] | null> {
    const accessToken = await this.authService.ensureValidToken(user);
    try {
      const response = await axios.get<StravaComment[]>(
        `${config.strava.apiUrl}/activities/${activityId}/comments`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { per_page: 100 },
        }
      );
      return response.data;
    } catch (error) {
      throwIfRateLimited(error);
      console.error(
        '[Comments] Error fetching comments:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  private async fetchPhotosFromStrava(
    activityId: number,
    user: User
  ): Promise<StravaPhoto[] | null> {
    const accessToken = await this.authService.ensureValidToken(user);
    try {
      const response = await axios.get<StravaPhoto[]>(
        `${config.strava.apiUrl}/activities/${activityId}/photos`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { size: 2048, photo_sources: true },
        }
      );
      return response.data;
    } catch (error) {
      throwIfRateLimited(error);
      console.error(
        '[Photos] Error fetching photos:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  // ─── DB row → Strava response shape ────────────────────────────────────────

  private kudoerToStrava(k: {
    id: string;
    athleteId: bigint | null;
    firstname: string | null;
    lastname: string | null;
    profile: string | null;
    profileMedium: string | null;
  }): StravaSummaryAthlete {
    // /kudos doesn't always return an athlete id; fall back to a numeric
    // hash of our row uuid so the frontend has a stable React key.
    const id = k.athleteId !== null ? Number(k.athleteId) : hashString(k.id);
    return {
      id,
      firstname: k.firstname ?? '',
      lastname: k.lastname ?? '',
      profile: k.profile ?? undefined,
      profile_medium: k.profileMedium ?? undefined,
    };
  }

  private commentToStrava(
    c: {
      id: bigint;
      athleteId: bigint | null;
      athleteFirstname: string | null;
      athleteLastname: string | null;
      athleteProfile: string | null;
      athleteProfileMedium: string | null;
      text: string;
      commentedAt: Date;
    },
    activityId: number
  ): StravaComment {
    // Fall back to a hash of the comment id when the athlete was stripped, so
    // the frontend has a stable, non-colliding React key.
    const athleteId = c.athleteId !== null ? Number(c.athleteId) : hashString(c.id.toString());
    return {
      id: Number(c.id),
      activity_id: activityId,
      text: c.text,
      created_at: c.commentedAt.toISOString(),
      athlete: {
        id: athleteId,
        firstname: c.athleteFirstname ?? '',
        lastname: c.athleteLastname ?? '',
        profile: c.athleteProfile ?? undefined,
        profile_medium: c.athleteProfileMedium ?? undefined,
      },
    };
  }

  private photoToStrava(
    p: {
      uniqueId: string;
      caption: string | null;
      urls: unknown;
      defaultPhoto: boolean;
      takenAt: Date | null;
    },
    activityId: number
  ): StravaPhoto {
    return {
      id: null,
      unique_id: p.uniqueId,
      urls: (p.urls as Record<string, string>) ?? {},
      source: 1,
      activity_id: activityId,
      resource_state: 2,
      caption: p.caption ?? null,
      default_photo: p.defaultPhoto,
      uploaded_at: p.takenAt ? p.takenAt.toISOString() : undefined,
    };
  }

  /**
   * Delete activities and recalculate all related stats
   * Used for testing activity sync flow
   */
  async deleteActivitiesAndRecalculate(
    userId: number,
    activityIds: number[]
  ): Promise<{
    deleted: number;
    challengeActivitiesRemoved: number;
    challengesUpdated: number;
  }> {
    console.info(`[Activities] Deleting ${activityIds.length} activities for user ${userId}`);
    console.info(`[Activities] Activity IDs: ${activityIds.join(', ')}`);

    // Convert to BigInt for database
    const bigIntIds = activityIds.map((id) => BigInt(id));

    // Find affected challenge participants before deleting
    const affectedChallengeActivities = await prisma.challengeActivity.findMany({
      where: {
        activityId: { in: bigIntIds },
        userId,
      },
      select: {
        challengeId: true,
        userId: true,
        distance: true,
        elevation: true,
        activityId: true,
      },
    });

    console.info(
      `[Activities] Found ${affectedChallengeActivities.length} challenge activities to remove`
    );

    if (affectedChallengeActivities.length > 0) {
      console.info('[Activities] Challenge activities details:');
      affectedChallengeActivities.forEach((ca) => {
        console.info(
          `  - Challenge ${ca.challengeId}, Activity ${ca.activityId}: ${ca.distance}m, ${ca.elevation}m elevation`
        );
      });
    }

    // Group by challenge participant for stats update
    const participantUpdates = new Map<
      string,
      { challengeId: string; userId: number; distance: number; elevation: number; count: number }
    >();

    for (const ca of affectedChallengeActivities) {
      const key = `${ca.challengeId}::${ca.userId}`;
      const existing = participantUpdates.get(key) || {
        challengeId: ca.challengeId,
        userId: ca.userId,
        distance: 0,
        elevation: 0,
        count: 0,
      };
      participantUpdates.set(key, {
        challengeId: ca.challengeId,
        userId: ca.userId,
        distance: existing.distance + ca.distance,
        elevation: existing.elevation + ca.elevation,
        count: existing.count + 1,
      });
    }

    console.info(`[Activities] Will update ${participantUpdates.size} challenge participants`);

    // Delete challenge activities
    const deletedChallengeActivities = await prisma.challengeActivity.deleteMany({
      where: {
        activityId: { in: bigIntIds },
        userId,
      },
    });

    console.info(`[Activities] Deleted ${deletedChallengeActivities.count} challenge activities`);

    // Update challenge participant stats (decrement)
    let updatedCount = 0;
    for (const [, updates] of participantUpdates) {
      // Get current stats before update
      const currentParticipant = await prisma.challengeParticipant.findUnique({
        where: {
          challengeId_userId: {
            challengeId: updates.challengeId,
            userId: updates.userId,
          },
        },
        select: {
          totalDistance: true,
          totalElevation: true,
          activityCount: true,
        },
      });

      console.info(
        `[Activities] Challenge ${updates.challengeId} participant ${updates.userId} BEFORE: ${currentParticipant?.totalDistance}m, ${currentParticipant?.totalElevation}m elev, ${currentParticipant?.activityCount} activities`
      );

      await prisma.challengeParticipant.update({
        where: {
          challengeId_userId: {
            challengeId: updates.challengeId,
            userId: updates.userId,
          },
        },
        data: {
          totalDistance: { decrement: updates.distance },
          totalElevation: { decrement: updates.elevation },
          activityCount: { decrement: updates.count },
        },
      });

      // Get stats after update
      const updatedParticipant = await prisma.challengeParticipant.findUnique({
        where: {
          challengeId_userId: {
            challengeId: updates.challengeId,
            userId: updates.userId,
          },
        },
        select: {
          totalDistance: true,
          totalElevation: true,
          activityCount: true,
        },
      });

      console.info(
        `[Activities] Challenge ${updates.challengeId} participant ${updates.userId} AFTER: ${updatedParticipant?.totalDistance}m, ${updatedParticipant?.totalElevation}m elev, ${updatedParticipant?.activityCount} activities`
      );
      console.info(
        `[Activities] Decremented: -${updates.distance}m, -${updates.elevation}m elev, -${updates.count} activities`
      );

      updatedCount++;
    }

    // Delete activities from database
    const { count } = await prisma.activity.deleteMany({
      where: {
        id: { in: bigIntIds },
        userId,
      },
    });

    console.info(`[Activities] Deleted ${count} activities`);

    // Delete related achievement progress (will be recalculated)
    await prisma.achievementProgress.deleteMany({
      where: { userId },
    });

    console.info(`[Activities] Cleared achievement progress for recalculation`);

    // Delete user stats (will be recalculated)
    await prisma.userStats.deleteMany({
      where: { userId },
    });

    console.info(`[Activities] Cleared stats for recalculation`);

    return {
      deleted: count,
      challengeActivitiesRemoved: deletedChallengeActivities.count,
      challengesUpdated: updatedCount,
    };
  }

  // ─── Webhook helpers ───────────────────────────────────────────────────────

  /**
   * Fetch one activity from Strava and upsert it into the DB. Used by the
   * webhook `activity:create` and `activity:update` handlers.
   */
  async upsertActivityFromStrava(activityId: number, user: User): Promise<void> {
    const accessToken = await this.authService.ensureValidToken(user);
    let activity: StravaActivity;
    try {
      const response = await axios.get<StravaActivity>(
        `${config.strava.apiUrl}/activities/${activityId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      activity = response.data;
    } catch (error) {
      throwIfRateLimited(error);
      throw error;
    }

    // Snapshot the existing row (if any) so we can detect create vs update +
    // photoCount delta for feed emission.
    const previous = await prisma.activity.findUnique({
      where: { id: BigInt(activityId) },
      select: { id: true, photoCount: true },
    });

    const data = this.mapStravaActivityToDb(activity, user.id);
    await prisma.activity.upsert({
      where: { id: BigInt(activityId) },
      create: data,
      update: {
        name: data.name,
        type: data.type,
        sportType: data.sportType,
        distance: data.distance,
        movingTime: data.movingTime,
        elapsedTime: data.elapsedTime,
        totalElevationGain: data.totalElevationGain,
        averageSpeed: data.averageSpeed,
        maxSpeed: data.maxSpeed,
        averageWatts: data.averageWatts,
        kilojoules: data.kilojoules,
        averageHeartrate: data.averageHeartrate,
        maxHeartrate: data.maxHeartrate,
        elevHigh: data.elevHigh,
        elevLow: data.elevLow,
        kudosCount: data.kudosCount,
        commentCount: data.commentCount,
        photoCount: data.photoCount,
        achievementCount: data.achievementCount,
        prCount: data.prCount,
        summaryPolyline: data.summaryPolyline,
        manual: data.manual,
        trainer: data.trainer,
      },
    });

    // Feed emission (best-effort).
    await this.emitFeedForUpsert(user.id, activity, data, previous?.photoCount ?? null).catch(
      (err) => console.error('[Feed] upsert emit failed:', err)
    );
  }

  /**
   * Apply Strava update-event field changes. Strava only sends `title`, `type`,
   * and `private` in update events.
   */
  async updateActivityFields(
    activityId: number,
    userId: number,
    updates: Record<string, string>
  ): Promise<void> {
    const data: Record<string, string> = {};
    if (typeof updates.title === 'string') data.name = updates.title;
    if (typeof updates.type === 'string') {
      data.type = updates.type;
      data.sportType = updates.type;
    }
    // `private` is not tracked in our schema; ignored intentionally.

    if (Object.keys(data).length === 0) return;

    await prisma.activity.updateMany({
      where: { id: BigInt(activityId), userId },
      data,
    });
  }

  /** Delete an activity owned by `userId`. Cascades to related rows. */
  async deleteActivityById(activityId: number, userId: number): Promise<void> {
    await prisma.activity.deleteMany({
      where: { id: BigInt(activityId), userId },
    });
  }

  /**
   * After inserting/updating an activity (e.g. from a webhook), recompute
   * challenge progress. PR enrichment is handled separately by the webhook
   * handler so a budget-exhausted PR fetch can't fail the rest of the event.
   */
  async syncChallengesForUser(user: User): Promise<{
    challengesSynced: number;
    challengeActivitiesAdded: number;
  }> {
    const challengeSync = await this.challengeService.syncActiveChallenges(user.id);
    return {
      challengesSynced: challengeSync.synced,
      challengeActivitiesAdded: challengeSync.activitiesAdded,
    };
  }

  /**
   * Emit one `activity_posted` FeedEvent per newly synced Strava activity.
   * Goes through `feedEventEmitter` (A1) so future cross-cutting concerns
   * (debounce, batching) land in one place.
   */
  private async emitActivityPostedEvents(
    userId: number,
    activities: StravaActivity[]
  ): Promise<void> {
    if (activities.length === 0) return;
    await feedEventEmitter.recordMany(
      activities.map((a) => ({
        actorId: userId,
        createdAt: new Date(a.start_date),
        payload: {
          type: 'activity_posted',
          entityType: 'activity',
          entityId: String(a.id),
          metadata: {
            name: a.name,
            type: a.type,
            distance: a.distance,
            movingTime: a.moving_time,
            totalElevationGain: a.total_elevation_gain,
            averageSpeed: a.average_speed,
          },
        },
      }))
    );
  }

  /**
   * Emit feed events for a webhook upsert: `activity_posted` when this is the
   * first time we see the activity, `photo_added` when the photoCount grew.
   */
  private async emitFeedForUpsert(
    userId: number,
    strava: StravaActivity,
    data: ReturnType<typeof this.mapStravaActivityToDb>,
    previousPhotoCount: number | null
  ): Promise<void> {
    if (previousPhotoCount === null) {
      // Create.
      await feedEventEmitter.record(userId, {
        type: 'activity_posted',
        entityType: 'activity',
        entityId: String(strava.id),
        metadata: {
          name: data.name,
          type: data.type,
          distance: data.distance,
          movingTime: data.movingTime,
          totalElevationGain: data.totalElevationGain,
          averageSpeed: data.averageSpeed,
        },
      });
      return;
    }
    // Update — only emit if photos were added.
    const delta = data.photoCount - previousPhotoCount;
    if (delta > 0) {
      await feedEventEmitter.record(userId, {
        type: 'photo_added',
        entityType: 'activity',
        entityId: String(strava.id),
        metadata: { count: delta },
      });
    }
  }

  /**
   * Map Strava API activity to database model
   */
  private mapStravaActivityToDb(
    activity: StravaActivity,
    userId: number
  ): {
    id: bigint;
    userId: number;
    name: string;
    type: string;
    sportType: string;
    distance: number;
    movingTime: number;
    elapsedTime: number;
    totalElevationGain: number;
    startDate: Date;
    startDateLocal: Date;
    averageSpeed: number;
    maxSpeed: number;
    averageWatts: number | undefined;
    kilojoules: number | undefined;
    averageHeartrate: number | undefined;
    maxHeartrate: number | undefined;
    elevHigh: number | undefined;
    elevLow: number | undefined;
    kudosCount: number;
    commentCount: number;
    photoCount: number;
    achievementCount: number;
    prCount: number;
    summaryPolyline: string | null;
    timezone: string;
    manual: boolean;
    trainer: boolean;
  } {
    return {
      id: BigInt(activity.id),
      userId,
      name: activity.name,
      type: activity.type,
      sportType: activity.sport_type,
      distance: activity.distance,
      movingTime: activity.moving_time,
      elapsedTime: activity.elapsed_time,
      totalElevationGain: activity.total_elevation_gain,
      startDate: new Date(activity.start_date),
      startDateLocal: new Date(activity.start_date_local),
      averageSpeed: activity.average_speed,
      maxSpeed: activity.max_speed,
      averageWatts: activity.average_watts,
      kilojoules: activity.kilojoules,
      averageHeartrate: activity.average_heartrate,
      maxHeartrate: activity.max_heartrate,
      elevHigh: activity.elev_high,
      elevLow: activity.elev_low,
      kudosCount: activity.kudos_count,
      commentCount: activity.comment_count,
      photoCount: activity.total_photo_count,
      achievementCount: activity.achievement_count,
      prCount: activity.pr_count,
      summaryPolyline: activity.map?.summary_polyline || null,
      timezone: activity.timezone,
      manual: activity.manual,
      trainer: activity.trainer,
    };
  }

  /**
   * Map database activity to Strava API format
   */
  private mapDbActivityToStrava(activity: {
    id: bigint;
    userId: number;
    name: string;
    type: string;
    sportType: string;
    distance: number;
    movingTime: number;
    elapsedTime: number;
    totalElevationGain: number;
    startDate: Date;
    startDateLocal: Date;
    averageSpeed: number;
    maxSpeed: number;
    averageWatts: number | null;
    kilojoules: number | null;
    averageHeartrate: number | null;
    maxHeartrate: number | null;
    elevHigh: number | null;
    elevLow: number | null;
    kudosCount: number;
    achievementCount: number;
    prCount: number;
    summaryPolyline: string | null;
    timezone: string;
    manual: boolean;
    trainer: boolean;
    createdAt: Date;
  }): StravaActivity {
    return {
      id: Number(activity.id),
      resource_state: 2,
      external_id: '',
      upload_id: 0,
      athlete: {
        id: activity.userId,
        resource_state: 1,
      },
      name: activity.name,
      distance: activity.distance,
      moving_time: activity.movingTime,
      elapsed_time: activity.elapsedTime,
      total_elevation_gain: activity.totalElevationGain,
      type: activity.type as StravaActivity['type'],
      sport_type: activity.sportType,
      start_date: activity.startDate.toISOString(),
      start_date_local: activity.startDateLocal.toISOString(),
      timezone: activity.timezone,
      utc_offset: 0,
      achievement_count: activity.achievementCount,
      kudos_count: activity.kudosCount,
      comment_count: 0,
      athlete_count: 1,
      photo_count: 0,
      map: {
        id: '',
        summary_polyline: activity.summaryPolyline || '',
        resource_state: 2,
      },
      trainer: activity.trainer,
      commute: false,
      manual: activity.manual,
      private: false,
      visibility: 'everyone',
      flagged: false,
      gear_id: '',
      average_speed: activity.averageSpeed,
      max_speed: activity.maxSpeed,
      average_watts: activity.averageWatts || undefined,
      kilojoules: activity.kilojoules || undefined,
      device_watts: false,
      has_heartrate: !!activity.averageHeartrate,
      average_heartrate: activity.averageHeartrate || undefined,
      max_heartrate: activity.maxHeartrate || undefined,
      heartrate_opt_out: false,
      display_hide_heartrate_option: false,
      elev_high: activity.elevHigh || undefined,
      elev_low: activity.elevLow || undefined,
      pr_count: activity.prCount,
      total_photo_count: 0,
      has_kudoed: false,
    };
  }
}

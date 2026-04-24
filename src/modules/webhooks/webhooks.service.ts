import axios from 'axios';
import { config } from '@config/env.js';
import { prisma } from '@shared/utils/index.js';
import { AppError } from '@shared/middleware/index.js';
import { HttpStatus } from '@shared/types/index.js';
import { ActivitiesService } from '../activities/activities.service.js';
import { AuthService } from '../auth/auth.service.js';
import type {
  ProcessingLogEntry,
  StravaSubscriptionApiResponse,
  StravaWebhookPayload,
  WebhookEventStatus,
} from './webhooks.types.js';
import type { WebhookEvent, WebhookSubscription } from '@prisma/client';

const SUBSCRIPTIONS_URL = 'https://www.strava.com/api/v3/push_subscriptions';
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Owns the lifecycle of Strava webhook subscriptions and the processing of
 * inbound webhook events. Every step appends to `WebhookEvent.processingLog`
 * so the admin panel can show exactly where things went right or wrong.
 */
export class WebhooksService {
  private activitiesService = new ActivitiesService();
  private authService = new AuthService();

  // ─── Subscription lifecycle ────────────────────────────────────────────────

  /**
   * Pre-creates a "pending" subscription row so the GET handshake can validate
   * the verify_token even before Strava returns the subscription id.
   */
  async createPendingSubscription(
    callbackUrl: string,
    verifyToken: string
  ): Promise<WebhookSubscription> {
    return prisma.webhookSubscription.create({
      data: { callbackUrl, verifyToken, status: 'pending' },
    });
  }

  async findPendingByVerifyToken(verifyToken: string): Promise<WebhookSubscription | null> {
    return prisma.webhookSubscription.findFirst({
      where: { verifyToken, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async activateSubscription(localId: number, stravaId: number): Promise<WebhookSubscription> {
    return prisma.webhookSubscription.update({
      where: { id: localId },
      data: { stravaId, status: 'active' },
    });
  }

  async getActiveSubscription(): Promise<WebhookSubscription | null> {
    return prisma.webhookSubscription.findFirst({
      where: { status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    return prisma.webhookSubscription.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async markSubscriptionDeleted(localId: number): Promise<void> {
    await prisma.webhookSubscription.update({
      where: { id: localId },
      data: { status: 'deleted', deletedAt: new Date() },
    });
  }

  // ─── Strava API: subscribe / unsubscribe / list ────────────────────────────

  /**
   * Calls Strava to register a new webhook subscription. Strava will GET our
   * callbackUrl with `hub.verify_token` and expect us to echo `hub.challenge`.
   */
  async subscribeOnStrava(
    callbackUrl: string,
    verifyToken: string
  ): Promise<StravaSubscriptionApiResponse> {
    console.info('[Webhooks] Subscribing on Strava', { callbackUrl });
    try {
      const params = new URLSearchParams({
        client_id: config.strava.clientId,
        client_secret: config.strava.clientSecret,
        callback_url: callbackUrl,
        verify_token: verifyToken,
      });
      const response = await axios.post<StravaSubscriptionApiResponse>(SUBSCRIPTIONS_URL, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30_000,
      });
      console.info('[Webhooks] Strava subscribe OK', { id: response.data.id });
      return response.data;
    } catch (error) {
      const detail = this.describeAxiosError(error);
      console.error('[Webhooks] Strava subscribe failed:', detail);
      throw new AppError(HttpStatus.BAD_REQUEST, `Strava subscribe failed: ${detail}`);
    }
  }

  async unsubscribeOnStrava(stravaId: number): Promise<void> {
    console.info('[Webhooks] Unsubscribing on Strava', { stravaId });
    try {
      const params = new URLSearchParams({
        client_id: config.strava.clientId,
        client_secret: config.strava.clientSecret,
      });
      await axios.delete(`${SUBSCRIPTIONS_URL}/${stravaId}`, {
        params,
        timeout: 30_000,
      });
      console.info('[Webhooks] Strava unsubscribe OK', { stravaId });
    } catch (error) {
      const detail = this.describeAxiosError(error);
      console.error('[Webhooks] Strava unsubscribe failed:', detail);
      throw new AppError(HttpStatus.BAD_REQUEST, `Strava unsubscribe failed: ${detail}`);
    }
  }

  async listOnStrava(): Promise<StravaSubscriptionApiResponse[]> {
    try {
      const response = await axios.get<StravaSubscriptionApiResponse[]>(SUBSCRIPTIONS_URL, {
        params: {
          client_id: config.strava.clientId,
          client_secret: config.strava.clientSecret,
        },
        timeout: 30_000,
      });
      return response.data;
    } catch (error) {
      const detail = this.describeAxiosError(error);
      console.error('[Webhooks] Strava list failed:', detail);
      throw new AppError(HttpStatus.BAD_REQUEST, `Strava list failed: ${detail}`);
    }
  }

  // ─── Event ingestion ───────────────────────────────────────────────────────

  /**
   * Insert the event into the audit log. Idempotent: returns the existing row
   * (with status=skipped) if we already saw an identical event in the last 5
   * minutes (Strava retries up to 3× on slow responses).
   */
  async recordEvent(
    payload: StravaWebhookPayload,
    source: 'strava' | 'simulated'
  ): Promise<{ event: WebhookEvent; isDuplicate: boolean }> {
    const eventTime = new Date(payload.event_time * 1000);
    const sinceWindow = new Date(Date.now() - DEDUP_WINDOW_MS);

    const existing = await prisma.webhookEvent.findFirst({
      where: {
        objectType: payload.object_type,
        objectId: BigInt(payload.object_id),
        aspectType: payload.aspect_type,
        eventTime,
        ownerId: BigInt(payload.owner_id),
        receivedAt: { gte: sinceWindow },
      },
    });

    if (existing) {
      console.info('[Webhooks] Duplicate event, skipping', { existingId: existing.id });
      return { event: existing, isDuplicate: true };
    }

    const event = await prisma.webhookEvent.create({
      data: {
        objectType: payload.object_type,
        objectId: BigInt(payload.object_id),
        aspectType: payload.aspect_type,
        ownerId: BigInt(payload.owner_id),
        subscriptionId: payload.subscription_id,
        eventTime,
        updates: payload.updates ?? {},
        rawPayload: payload as unknown as object,
        source,
        status: 'pending',
        processingLog: [this.logEntry('info', `Received via ${source}`)] as unknown as object,
      },
    });
    return { event, isDuplicate: false };
  }

  // ─── Event processing ──────────────────────────────────────────────────────

  /**
   * Dispatch the event to the right handler. Always resolves — never throws —
   * so that a failure here can't break the response path. Errors are captured
   * onto the event row.
   */
  async processEventSafely(eventId: string): Promise<void> {
    let event: WebhookEvent | null = null;
    try {
      event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
      if (!event) {
        console.error('[Webhooks] processEventSafely: event not found', { eventId });
        return;
      }

      await this.appendLog(eventId, 'info', 'Processing started');
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'processing', attempts: { increment: 1 } },
      });

      await this.dispatch(event, eventId);

      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'processed', processedAt: new Date(), error: null },
      });
      await this.appendLog(eventId, 'info', '✅ Processed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error('[Webhooks] Event processing failed', { eventId, message, stack });
      try {
        await this.appendLog(eventId, 'error', `Failed: ${message}`);
        if (stack) await this.appendLog(eventId, 'error', stack);
        await prisma.webhookEvent.update({
          where: { id: eventId },
          data: { status: 'failed', error: message },
        });
      } catch (logErr) {
        console.error('[Webhooks] Failed to record failure on event', logErr);
      }
    }
  }

  private async dispatch(event: WebhookEvent, eventId: string): Promise<void> {
    const ownerId = Number(event.ownerId);
    const objectId = Number(event.objectId);
    const key = `${event.objectType}:${event.aspectType}`;

    await this.appendLog(eventId, 'info', `Dispatching ${key}`);

    const user = await this.authService.getUserByStravaId(ownerId);
    if (!user) {
      await this.appendLog(eventId, 'warn', `No user with stravaId=${ownerId}; skipping`);
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'skipped' },
      });
      return;
    }
    await this.appendLog(eventId, 'info', `Resolved user id=${user.id}`);

    if (event.objectType === 'activity' && event.aspectType === 'create') {
      await this.appendLog(eventId, 'info', `Fetching activity ${objectId} from Strava`);
      await this.activitiesService.upsertActivityFromStrava(objectId, user);
      await this.appendLog(eventId, 'info', 'Upserted activity into DB');

      await this.appendLog(eventId, 'info', 'Syncing active challenges');
      const result = await this.activitiesService.syncChallengesAndPRs(user);
      await this.appendLog(
        eventId,
        'info',
        `Challenges: synced=${result.challengesSynced} added=${result.challengeActivitiesAdded}`
      );
      return;
    }

    if (event.objectType === 'activity' && event.aspectType === 'update') {
      const updates = (event.updates ?? {}) as Record<string, string>;
      await this.appendLog(eventId, 'info', `Updates: ${JSON.stringify(updates)}`);
      await this.activitiesService.updateActivityFields(objectId, user.id, updates);
      await this.appendLog(eventId, 'info', 'Applied updates');
      return;
    }

    if (event.objectType === 'activity' && event.aspectType === 'delete') {
      await this.activitiesService.deleteActivityById(objectId, user.id);
      await this.appendLog(eventId, 'info', 'Deleted activity');
      return;
    }

    if (event.objectType === 'athlete' && event.aspectType === 'update') {
      const updates = (event.updates ?? {}) as Record<string, string>;
      if (updates.authorized === 'false') {
        await this.appendLog(eventId, 'info', 'Athlete deauthorized — clearing tokens');
        await this.authService.handleDeauthorization(user.id);
      } else {
        await this.appendLog(eventId, 'info', 'Athlete update without deauth — no-op');
      }
      return;
    }

    await this.appendLog(eventId, 'warn', `No handler for ${key}; marking skipped`);
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { status: 'skipped' },
    });
  }

  // ─── Querying for the admin panel ──────────────────────────────────────────

  async listEvents(filters: {
    status?: WebhookEventStatus;
    limit?: number;
  }): Promise<WebhookEvent[]> {
    return prisma.webhookEvent.findMany({
      where: filters.status ? { status: filters.status } : undefined,
      orderBy: { receivedAt: 'desc' },
      take: filters.limit ?? 50,
    });
  }

  async getEvent(id: string): Promise<WebhookEvent | null> {
    return prisma.webhookEvent.findUnique({ where: { id } });
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private logEntry(level: ProcessingLogEntry['level'], message: string): ProcessingLogEntry {
    return { ts: new Date().toISOString(), level, message };
  }

  /** Append to both console and the event's processingLog field. */
  private async appendLog(
    eventId: string,
    level: ProcessingLogEntry['level'],
    message: string
  ): Promise<void> {
    const entry = this.logEntry(level, message);
    const prefix = `[Webhook ${eventId.slice(0, 8)}]`;
    if (level === 'error') console.error(prefix, message);
    else if (level === 'warn') console.warn(prefix, message);
    else console.info(prefix, message);

    try {
      const event = await prisma.webhookEvent.findUnique({
        where: { id: eventId },
        select: { processingLog: true },
      });
      const existing = (event?.processingLog as ProcessingLogEntry[] | null) ?? [];
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { processingLog: [...existing, entry] as unknown as object },
      });
    } catch (err) {
      console.error(`${prefix} Failed to persist log entry`, err);
    }
  }

  private describeAxiosError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const body: unknown = error.response?.data;
      const bodyStr = typeof body === 'string' ? body : body ? JSON.stringify(body) : '<no body>';
      return `HTTP ${status ?? '?'} — ${bodyStr}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}

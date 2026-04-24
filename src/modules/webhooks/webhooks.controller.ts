import type { NextFunction, Request, Response } from 'express';
import { config } from '@config/env.js';
import { HttpStatus } from '@shared/types/index.js';
import { WebhooksService } from './webhooks.service.js';
import type { StravaWebhookPayload, WebhookEventStatus } from './webhooks.types.js';

const sanitizeStatus = (raw: unknown): WebhookEventStatus | undefined => {
  const allowed: WebhookEventStatus[] = ['pending', 'processing', 'processed', 'failed', 'skipped'];
  if (typeof raw !== 'string') return undefined;
  return (allowed as string[]).includes(raw) ? (raw as WebhookEventStatus) : undefined;
};

/**
 * Convert BigInts to strings and Dates to ISO strings recursively so
 * JSON.stringify produces useful output. The frontend treats BigInt fields
 * as opaque identifiers.
 */
const serialize = <T>(value: T): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serialize(v)])
    );
  }
  return value;
};

export class WebhooksController {
  private service = new WebhooksService();

  // ─── Public: Strava-facing ─────────────────────────────────────────────────

  /**
   * GET /api/webhooks/strava
   * Subscription handshake. Strava sends `hub.mode=subscribe`,
   * `hub.verify_token=<our token>`, `hub.challenge=<random>`. We must echo
   * the challenge if our verify token matches a pending subscription row.
   */
  handshake = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      console.info('[Webhooks] Handshake GET', {
        mode,
        hasToken: !!token,
        hasChallenge: !!challenge,
        ip: req.ip,
      });

      if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') {
        console.warn('[Webhooks] Handshake missing required params');
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Missing hub.mode / hub.verify_token / hub.challenge',
        });
        return;
      }

      const pending = await this.service.findPendingByVerifyToken(token);
      if (!pending) {
        console.warn('[Webhooks] Handshake verify_token does not match any pending subscription');
        res.status(HttpStatus.FORBIDDEN).json({
          success: false,
          error: 'verify_token does not match a pending subscription',
        });
        return;
      }

      console.info('[Webhooks] Handshake OK, echoing challenge', { localId: pending.id });
      res.status(HttpStatus.OK).json({ 'hub.challenge': challenge });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/webhooks/strava
   * Persist the event then respond 200 within Strava's 2-second budget. Then
   * process synchronously — Vercel keeps the function alive until the handler
   * returns, but the response has already gone out.
   */
  receive = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = req.body as StravaWebhookPayload | undefined;
      console.info('[Webhooks] Inbound POST', payload);

      if (
        !payload ||
        typeof payload.object_type !== 'string' ||
        typeof payload.aspect_type !== 'string' ||
        typeof payload.object_id !== 'number' ||
        typeof payload.owner_id !== 'number' ||
        typeof payload.event_time !== 'number' ||
        typeof payload.subscription_id !== 'number'
      ) {
        console.warn('[Webhooks] Malformed payload — responding 200 to suppress retries');
        // Still respond 200 so Strava doesn't keep retrying obviously bad events.
        res.status(HttpStatus.OK).json({ accepted: false, reason: 'malformed' });
        return;
      }

      const { event, isDuplicate } = await this.service.recordEvent(payload, 'strava');

      // Acknowledge first — must happen within 2s.
      res.status(HttpStatus.OK).json({ accepted: true, eventId: event.id, isDuplicate });

      if (!isDuplicate) {
        // Continue processing on the same invocation. Awaiting ensures Vercel
        // keeps the function alive until processing finishes.
        await this.service.processEventSafely(event.id);
      }
    } catch (error) {
      // We may already have sent the response; only forward if not.
      if (!res.headersSent) next(error);
      else console.error('[Webhooks] Error after response sent:', error);
    }
  };

  // ─── Admin ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/webhooks/diagnostics
   * Env + config dump so prod debugging doesn't need shell access.
   */
  diagnostics = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const local = await this.service.listSubscriptions();
      res.json({
        success: true,
        data: {
          env: {
            nodeEnv: config.nodeEnv,
            isVercel: !!process.env.VERCEL,
            vercelEnv: process.env.VERCEL_ENV ?? null,
            allowedOrigins: config.allowedOrigins,
            stravaClientId: config.strava.clientId,
            stravaApiUrl: config.strava.apiUrl,
          },
          localSubscriptions: serialize(local),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/admin/webhooks/status
   * Live query Strava + return our local active subscription.
   */
  status = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [stravaSubscriptions, local] = await Promise.all([
        this.service.listOnStrava().catch((err: unknown) => ({
          error: err instanceof Error ? err.message : String(err),
        })),
        this.service.getActiveSubscription(),
      ]);
      res.json({
        success: true,
        data: {
          strava: stravaSubscriptions,
          local: serialize(local),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/admin/webhooks/subscribe
   * Body: { callbackUrl, verifyToken }
   * Pre-creates a pending row, calls Strava, and activates the row on success.
   */
  subscribe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { callbackUrl, verifyToken } = req.body as {
        callbackUrl?: unknown;
        verifyToken?: unknown;
      };
      if (typeof callbackUrl !== 'string' || !callbackUrl.startsWith('http')) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'callbackUrl must be an http(s) URL',
        });
        return;
      }
      if (typeof verifyToken !== 'string' || verifyToken.length < 8) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'verifyToken must be at least 8 characters',
        });
        return;
      }

      const pending = await this.service.createPendingSubscription(callbackUrl, verifyToken);
      console.info('[Webhooks] Created pending subscription', { localId: pending.id });

      try {
        const stravaResponse = await this.service.subscribeOnStrava(callbackUrl, verifyToken);
        const active = await this.service.activateSubscription(pending.id, stravaResponse.id);
        res.json({
          success: true,
          data: {
            local: serialize(active),
            strava: stravaResponse,
          },
        });
      } catch (error) {
        // Subscribe failed (handshake or HTTP error). Mark pending row deleted.
        await this.service.markSubscriptionDeleted(pending.id);
        throw error;
      }
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /api/admin/webhooks/subscribe/:stravaId
   */
  unsubscribe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stravaId = parseInt(req.params.stravaId, 10);
      if (!stravaId || stravaId <= 0) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'stravaId must be a positive integer',
        });
        return;
      }

      await this.service.unsubscribeOnStrava(stravaId);

      const local = await this.service.getActiveSubscription();
      if (local && local.stravaId === stravaId) {
        await this.service.markSubscriptionDeleted(local.id);
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /api/admin/webhooks/events?status=&limit=
   */
  listEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const status = sanitizeStatus(req.query.status);
      const rawLimit = typeof req.query.limit === 'string' ? req.query.limit : '';
      const limit = rawLimit ? Math.min(200, parseInt(rawLimit, 10)) : 50;
      const events = await this.service.listEvents({ status, limit });
      res.json({ success: true, data: serialize(events) });
    } catch (error) {
      next(error);
    }
  };

  /** GET /api/admin/webhooks/events/:id */
  getEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const event = await this.service.getEvent(req.params.id);
      if (!event) {
        res.status(HttpStatus.NOT_FOUND).json({ success: false, error: 'Event not found' });
        return;
      }
      res.json({ success: true, data: serialize(event) });
    } catch (error) {
      next(error);
    }
  };

  /** POST /api/admin/webhooks/events/:id/retry */
  retryEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const event = await this.service.getEvent(req.params.id);
      if (!event) {
        res.status(HttpStatus.NOT_FOUND).json({ success: false, error: 'Event not found' });
        return;
      }
      // Run synchronously so the admin sees the result immediately.
      await this.service.processEventSafely(event.id);
      const updated = await this.service.getEvent(event.id);
      res.json({ success: true, data: serialize(updated) });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /api/admin/webhooks/simulate
   * Body: full Strava webhook payload. Goes through the same pipeline as a
   * real event — useful for testing locally without a live subscription.
   */
  simulate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = req.body as StravaWebhookPayload | undefined;
      if (
        !payload ||
        typeof payload.object_type !== 'string' ||
        typeof payload.aspect_type !== 'string' ||
        typeof payload.object_id !== 'number' ||
        typeof payload.owner_id !== 'number'
      ) {
        res.status(HttpStatus.BAD_REQUEST).json({
          success: false,
          error: 'Invalid simulated payload — needs object_type, object_id, aspect_type, owner_id',
        });
        return;
      }
      const fullPayload: StravaWebhookPayload = {
        object_type: payload.object_type,
        object_id: payload.object_id,
        aspect_type: payload.aspect_type,
        updates: payload.updates ?? {},
        owner_id: payload.owner_id,
        subscription_id: payload.subscription_id ?? 0,
        event_time: payload.event_time ?? Math.floor(Date.now() / 1000),
      };
      const { event, isDuplicate } = await this.service.recordEvent(fullPayload, 'simulated');
      if (!isDuplicate) {
        await this.service.processEventSafely(event.id);
      }
      const updated = await this.service.getEvent(event.id);
      res.json({ success: true, data: serialize(updated), isDuplicate });
    } catch (error) {
      next(error);
    }
  };
}

import type { Request, Response } from 'express';
import { StravaWebhookService } from './strava-webhook.service.js';

export class WebhooksController {
  private stravaWebhookService: StravaWebhookService;

  constructor() {
    this.stravaWebhookService = new StravaWebhookService();
  }

  /**
   * GET /api/webhooks/strava
   * Validates Strava webhook subscription
   * Called once by Strava to verify the callback URL
   */
  validateStravaWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        'hub.mode': mode,
        'hub.challenge': challenge,
        'hub.verify_token': verifyToken,
      } = req.query;

      console.info('[Strava Webhook] Validation request received', {
        mode,
        challenge,
        verifyToken,
      });

      // Verify the token matches our secret
      if (verifyToken !== process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
        console.error('[Strava Webhook] Invalid verify token');
        res.status(403).json({ error: 'Invalid verify token' });
        return;
      }

      if (mode !== 'subscribe') {
        console.error('[Strava Webhook] Invalid mode');
        res.status(400).json({ error: 'Invalid mode' });
        return;
      }

      // Respond with the challenge to complete validation
      console.info('[Strava Webhook] Validation successful');
      res.status(200).json({ 'hub.challenge': challenge });
    } catch (error) {
      console.error('[Strava Webhook] Validation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * POST /api/webhooks/strava
   * Handles Strava webhook events
   * Called by Strava when activities are created/updated/deleted
   */
  handleStravaWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const event = req.body as unknown;

      console.info('[Strava Webhook] Event received:', JSON.stringify(event, null, 2));

      // Respond immediately (within 2 seconds)
      res.status(200).json({ received: true });

      // Process event asynchronously (don't block response)
      setImmediate(() => {
        this.stravaWebhookService
          .processEvent(event as Parameters<typeof this.stravaWebhookService.processEvent>[0])
          .catch((error) => console.error('[Strava Webhook] Error processing event:', error));
      });
    } catch (error) {
      console.error('[Strava Webhook] Handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

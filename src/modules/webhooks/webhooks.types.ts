/**
 * Strava webhook payload — POSTed to our callback when an event fires.
 * https://developers.strava.com/docs/webhooks/
 */
export interface StravaWebhookPayload {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  updates: Record<string, string>;
  owner_id: number;
  subscription_id: number;
  event_time: number;
}

/**
 * Strava handshake query params on GET.
 * Strava sends `hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
 * during subscription validation.
 */
export interface StravaHubChallenge {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

export interface StravaSubscriptionApiResponse {
  id: number;
  resource_state?: number;
  application_id?: number;
  callback_url: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessingLogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type WebhookEventStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'skipped';

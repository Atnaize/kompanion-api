import { Client, Receiver } from '@upstash/qstash';
import { config } from '@config/env.js';

/**
 * Decouples webhook ack from webhook processing. The Strava-facing handler
 * persists the event row and immediately publishes a tiny `{ eventId }`
 * message to QStash, then returns 200 within a few hundred milliseconds.
 *
 * QStash POSTs back to `WEBHOOK_WORKER_URL` with retries, exponential
 * backoff, and a DLQ. The worker route claims the row, dispatches it, and
 * writes the final status. If processing throws, returning a non-2xx tells
 * QStash to retry — so we no longer rely on synchronous in-invocation
 * processing to survive Vercel function timeouts.
 */
class WebhooksQueue {
  private readonly client = new Client({ token: config.qstash.token });
  private readonly receiver = new Receiver({
    currentSigningKey: config.qstash.currentSigningKey,
    nextSigningKey: config.qstash.nextSigningKey,
  });

  /**
   * Publish a `{ eventId }` message. QStash will POST it back to
   * `WEBHOOK_WORKER_URL` — caller is responsible for inserting the row
   * first so the worker can look it up.
   *
   * `retries` here is the QStash-level retry count; default 3 with
   * exponential backoff is fine for our workload.
   */
  async publish(eventId: string): Promise<void> {
    await this.client.publishJSON({
      url: config.qstash.workerUrl,
      body: { eventId },
      retries: 3,
    });
  }

  /**
   * Verify an inbound QStash request. Throws on invalid signature so the
   * worker route can respond 401 and QStash can decide whether to retry.
   */
  async verify(args: { signature: string; body: string; url: string }): Promise<boolean> {
    return this.receiver.verify(args);
  }
}

export const webhooksQueue = new WebhooksQueue();

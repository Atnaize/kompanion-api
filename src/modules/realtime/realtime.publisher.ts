import * as Ably from 'ably';
import { config } from '../../config/env.js';

/**
 * Realtime fan-out via Ably. The browser never holds our API key — it pulls a
 * short-lived, capability-scoped token from `POST /api/realtime/token`.
 * Publishing is best-effort: when `ABLY_API_KEY` is unset the publisher is a
 * no-op and clients fall back to polling.
 *
 * Events are intentionally payload-light: the client treats any message on a
 * channel as "something changed — refetch", keeping the React Query cache the
 * single source of truth and avoiding optimistic-merge bugs. This also means a
 * publish can't leak content to a (capability-gated) subscriber.
 */
class RealtimePublisher {
  private readonly rest: Ably.Rest | null;

  constructor() {
    this.rest = config.realtime.ablyApiKey
      ? new Ably.Rest({ key: config.realtime.ablyApiKey })
      : null;
    if (!this.rest) {
      console.warn('[Realtime] ABLY_API_KEY not set — realtime disabled; clients will poll.');
    }
  }

  get enabled(): boolean {
    return this.rest !== null;
  }

  /** Notify subscribers of a conversation thread that it changed. */
  async publishToConversation(conversationId: string, event = 'changed'): Promise<void> {
    await this.publish(`conversation:${conversationId}`, event);
  }

  /** Notify a user's personal channel (drives inbox/badge liveness). */
  async publishToUser(userId: number, event = 'changed'): Promise<void> {
    await this.publish(`user:${userId}`, event);
  }

  /**
   * Mint a capability-scoped Ably token request: subscribe-only on the viewer's
   * own channel plus each conversation they can access — so the browser can
   * never subscribe to a stranger's thread. Null when realtime is disabled.
   *
   * Capabilities are a snapshot at mint time: joining a new conversation (club,
   * challenge or group) only grants its channel after the next token renewal —
   * until then that thread quietly falls back to polling/refetch.
   */
  async createTokenRequest(
    userId: number,
    conversationIds: string[]
  ): Promise<Ably.TokenRequest | null> {
    if (!this.rest) return null;
    const capability: Record<string, string[]> = { [`user:${userId}`]: ['subscribe'] };
    for (const id of conversationIds) {
      capability[`conversation:${id}`] = ['subscribe'];
    }
    return this.rest.auth.createTokenRequest({
      clientId: String(userId),
      capability: JSON.stringify(capability),
    });
  }

  private async publish(channel: string, event: string): Promise<void> {
    if (!this.rest) return;
    try {
      await this.rest.channels.get(channel).publish(event, {});
    } catch (err) {
      console.error(`[Realtime] publish to ${channel} failed:`, err);
    }
  }
}

export const realtimePublisher = new RealtimePublisher();

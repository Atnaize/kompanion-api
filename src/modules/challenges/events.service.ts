import { prisma } from '@shared/utils/index.js';
import type { ChallengeEvent } from '@shared/types/index.js';
import crypto from 'crypto';

export class EventsService {
  /**
   * Get events for a challenge since a given timestamp
   */
  async getChallengeEvents(
    challengeId: string,
    since?: Date
  ): Promise<{ events: ChallengeEvent[]; etag: string }> {
    const whereClause = since
      ? {
          challengeId,
          createdAt: {
            gt: since,
          },
        }
      : { challengeId };

    const events = await prisma.challengeEvent.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'asc',
      },
      take: 100, // Limit to prevent huge responses
    });

    // Generate ETag based on latest event timestamp and count
    const latestTimestamp = events.length > 0 ? events[events.length - 1].createdAt : new Date();
    const etag = this.generateETag(challengeId, latestTimestamp, events.length);

    return {
      events: events as unknown as ChallengeEvent[],
      etag,
    };
  }

  /**
   * Get events for all challenges a user is participating in
   */
  async getUserChallengeEvents(
    userId: number,
    since?: Date
  ): Promise<{ events: ChallengeEvent[]; etag: string }> {
    // Get all challenges the user is participating in
    const participantRecords = await prisma.challengeParticipant.findMany({
      where: {
        userId,
        status: 'accepted',
      },
      select: {
        challengeId: true,
      },
    });

    const challengeIds = participantRecords.map((p) => p.challengeId);

    if (challengeIds.length === 0) {
      return {
        events: [],
        etag: this.generateETag('no-challenges', new Date(), 0),
      };
    }

    const whereClause = since
      ? {
          challengeId: {
            in: challengeIds,
          },
          createdAt: {
            gt: since,
          },
        }
      : {
          challengeId: {
            in: challengeIds,
          },
        };

    const events = await prisma.challengeEvent.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'asc',
      },
      take: 100, // Limit to prevent huge responses
    });

    // Generate ETag
    const latestTimestamp = events.length > 0 ? events[events.length - 1].createdAt : new Date();
    const etag = this.generateETag(`user-${userId}`, latestTimestamp, events.length);

    return {
      events: events as unknown as ChallengeEvent[],
      etag,
    };
  }

  /**
   * Get the latest event timestamp for a challenge
   * Used for polling optimization
   */
  async getLatestEventTimestamp(challengeId: string): Promise<Date | null> {
    const latestEvent = await prisma.challengeEvent.findFirst({
      where: { challengeId },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        createdAt: true,
      },
    });

    return latestEvent?.createdAt || null;
  }

  /**
   * Generate ETag for caching
   */
  private generateETag(identifier: string, timestamp: Date, count: number): string {
    const content = `${identifier}-${timestamp.getTime()}-${count}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Clean up old events (older than 30 days)
   * Should be called periodically by cron
   */
  async cleanupOldEvents(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await prisma.challengeEvent.deleteMany({
      where: {
        createdAt: {
          lt: thirtyDaysAgo,
        },
      },
    });

    return result.count;
  }
}

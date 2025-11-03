import { prisma } from '@shared/utils/index.js';
import type { ChallengeTargets } from '@shared/types/index.js';

export class CronService {
  /**
   * Check and update challenges that have reached their deadline
   */
  async checkChallengeDeadlines(): Promise<{
    processed: number;
    completed: number;
    failed: number;
  }> {
    const now = new Date();

    // Find active challenges that have passed their end date
    const expiredChallenges = await prisma.challenge.findMany({
      where: {
        status: 'active',
        endDate: {
          lt: now,
        },
      },
      include: {
        participants: {
          where: {
            status: 'accepted',
          },
        },
      },
    });

    let completed = 0;
    let failed = 0;

    for (const challenge of expiredChallenges) {
      const success = await this.evaluateChallenge(challenge);

      if (success) {
        // Update challenge status to completed
        await prisma.challenge.update({
          where: { id: challenge.id },
          data: { status: 'completed' },
        });

        // Create completion event
        await prisma.challengeEvent.create({
          data: {
            challengeId: challenge.id,
            userId: null, // System event
            type: 'completed',
            data: {
              completedAt: now,
              participantCount: challenge.participants.length,
            },
          },
        });

        completed++;
      } else {
        // Update challenge status to failed
        await prisma.challenge.update({
          where: { id: challenge.id },
          data: { status: 'failed' },
        });

        // Create failure event
        await prisma.challengeEvent.create({
          data: {
            challengeId: challenge.id,
            userId: null, // System event
            type: 'failed',
            data: {
              failedAt: now,
              participantCount: challenge.participants.length,
            },
          },
        });

        failed++;
      }
    }

    return {
      processed: expiredChallenges.length,
      completed,
      failed,
    };
  }

  /**
   * Evaluate if a challenge met its goals
   */
  private async evaluateChallenge(challenge: {
    id: string;
    type: string;
    targets: unknown;
    competitiveGoal: string | null;
    participants: Array<{
      totalDistance: number;
      totalElevation: number;
    }>;
  }): Promise<boolean> {
    const targets = challenge.targets as ChallengeTargets;

    if (challenge.type === 'collaborative') {
      // For collaborative: sum all participants' progress
      const totalDistance = challenge.participants.reduce((sum, p) => sum + p.totalDistance, 0);
      const totalElevation = challenge.participants.reduce((sum, p) => sum + p.totalElevation, 0);

      const distanceGoalMet = !targets.distance || totalDistance >= targets.distance;
      const elevationGoalMet = !targets.elevation || totalElevation >= targets.elevation;

      return distanceGoalMet && elevationGoalMet;
    }

    // For competitive: at least one participant must have progress
    // (We'll implement more sophisticated competitive evaluation in v2)
    return challenge.participants.some((p) => p.totalDistance > 0 || p.totalElevation > 0);
  }

  /**
   * Clean up old events (older than 30 days)
   */
  async cleanupOldEvents(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await prisma.challengeEvent.deleteMany({
      where: {
        createdAt: {
          lt: thirtyDaysAgo,
        },
        // Don't delete important milestone events
        type: {
          notIn: ['completed', 'failed', 'started'],
        },
      },
    });

    return result.count;
  }

  /**
   * Clean up expired refresh tokens
   */
  async cleanupExpiredTokens(): Promise<number> {
    const now = new Date();

    const result = await prisma.refreshToken.deleteMany({
      where: {
        OR: [
          {
            expiresAt: {
              lt: now,
            },
          },
          {
            revokedAt: {
              not: null,
            },
          },
        ],
      },
    });

    return result.count;
  }
}

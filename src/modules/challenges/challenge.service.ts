import { prisma } from '@shared/utils/index.js';
import type {
  Challenge,
  ChallengeTargets,
  ChallengeType,
  CompetitiveGoal,
  ParticipantStatus,
} from '@shared/types/index.js';
import type { Prisma } from '@prisma/client';

interface CreateChallengeData {
  creatorId: number;
  name: string;
  description?: string;
  type: ChallengeType;
  startDate: Date;
  endDate: Date;
  targets: ChallengeTargets;
  competitiveGoal?: CompetitiveGoal;
  invitedUserIds?: number[];
}

interface UpdateChallengeData {
  name?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  targets?: ChallengeTargets;
}

export class ChallengeService {
  /**
   * Create a new challenge
   */
  async createChallenge(data: CreateChallengeData): Promise<Challenge> {
    const { invitedUserIds, ...challengeData } = data;

    // Validate dates
    if (challengeData.startDate >= challengeData.endDate) {
      throw new Error('Start date must be before end date');
    }

    // Validate competitive goal
    if (challengeData.type === 'competitive' && !challengeData.competitiveGoal) {
      throw new Error('Competitive challenges must have a competitive goal');
    }

    if (challengeData.type === 'collaborative' && challengeData.competitiveGoal) {
      throw new Error('Collaborative challenges cannot have a competitive goal');
    }

    // Create challenge with participants
    const challenge = await prisma.challenge.create({
      data: {
        ...challengeData,
        status: 'draft',
        targets: challengeData.targets as Prisma.InputJsonValue,
        participants: {
          create: [
            // Creator automatically accepts
            {
              userId: challengeData.creatorId,
              status: 'accepted',
              acceptedAt: new Date(),
            },
            // Invited users start as invited
            ...(invitedUserIds || []).map((userId) => ({
              userId,
              status: 'invited' as ParticipantStatus,
            })),
          ],
        },
      },
      include: {
        creator: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            profile: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    // Create event
    await prisma.challengeEvent.create({
      data: {
        challengeId: challenge.id,
        userId: challengeData.creatorId,
        type: 'created',
        data: {
          challengeName: challenge.name,
          invitedCount: invitedUserIds?.length || 0,
        },
      },
    });

    return challenge as unknown as Challenge;
  }

  /**
   * Get a challenge by ID
   */
  async getChallengeById(challengeId: string, userId?: number): Promise<Challenge | null> {
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        creator: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            profile: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                profile: true,
              },
            },
          },
          orderBy: {
            totalDistance: 'desc',
          },
        },
      },
    });

    if (!challenge) {
      return null;
    }

    // Check if user has access to this challenge
    if (userId) {
      const isParticipant = challenge.participants.some((p) => p.userId === userId);
      if (!isParticipant) {
        throw new Error('You do not have access to this challenge');
      }
    }

    return challenge as unknown as Challenge;
  }

  /**
   * Get all challenges for a user
   */
  async getChallengesForUser(
    userId: number,
    filters?: {
      status?: string;
      type?: ChallengeType;
    }
  ): Promise<Challenge[]> {
    const challenges = await prisma.challenge.findMany({
      where: {
        participants: {
          some: {
            userId,
            status: {
              in: ['accepted', 'invited'],
            },
          },
        },
        ...(filters?.status && { status: filters.status }),
        ...(filters?.type && { type: filters.type }),
      },
      include: {
        creator: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            profile: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                profile: true,
              },
            },
          },
          orderBy: {
            totalDistance: 'desc',
          },
        },
      },
      orderBy: {
        endDate: 'asc',
      },
    });

    return challenges as unknown as Challenge[];
  }

  /**
   * Update a challenge
   */
  async updateChallenge(
    challengeId: string,
    userId: number,
    data: UpdateChallengeData
  ): Promise<Challenge> {
    // Verify user is the creator
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new Error('Challenge not found');
    }

    if (challenge.creatorId !== userId) {
      throw new Error('Only the creator can update this challenge');
    }

    if (challenge.status !== 'draft' && challenge.status !== 'active') {
      throw new Error('Cannot update completed or cancelled challenges');
    }

    // Validate dates if provided
    if (data.startDate || data.endDate) {
      const startDate = data.startDate || challenge.startDate;
      const endDate = data.endDate || challenge.endDate;

      if (startDate >= endDate) {
        throw new Error('Start date must be before end date');
      }
    }

    const updated = await prisma.challenge.update({
      where: { id: challengeId },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.startDate && { startDate: data.startDate }),
        ...(data.endDate && { endDate: data.endDate }),
        ...(data.targets && { targets: data.targets as Prisma.InputJsonValue }),
      },
      include: {
        creator: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            profile: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    return updated as unknown as Challenge;
  }

  /**
   * Start a challenge (move from draft to active)
   */
  async startChallenge(challengeId: string, userId: number): Promise<Challenge> {
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        participants: {
          where: { status: 'accepted' },
        },
      },
    });

    if (!challenge) {
      throw new Error('Challenge not found');
    }

    if (challenge.creatorId !== userId) {
      throw new Error('Only the creator can start this challenge');
    }

    if (challenge.status !== 'draft') {
      throw new Error('Challenge must be in draft status to start');
    }

    // Check if at least one other participant has accepted
    const acceptedCount = challenge.participants.length;

    if (acceptedCount < 2) {
      throw new Error('Challenge needs at least 2 participants to start');
    }

    // Update challenge status to active
    const updated = await prisma.challenge.update({
      where: { id: challengeId },
      data: { status: 'active' },
      include: {
        creator: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            profile: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    // Retroactively count activities that occurred during the challenge period
    await this.countRetroactiveActivities(
      challengeId,
      challenge.startDate,
      challenge.endDate,
      challenge.participants.map((p) => p.userId)
    );

    // Create event
    await prisma.challengeEvent.create({
      data: {
        challengeId,
        userId,
        type: 'started',
        data: {
          participantCount: acceptedCount,
        },
      },
    });

    return updated as unknown as Challenge;
  }

  /**
   * Count and add activities that occurred during the challenge period
   * This is called when a challenge is started to include past activities
   */
  private async countRetroactiveActivities(
    challengeId: string,
    startDate: Date,
    endDate: Date,
    participantUserIds: number[]
  ): Promise<void> {
    // Find all activities for accepted participants within the challenge date range
    const activities = await prisma.activity.findMany({
      where: {
        userId: { in: participantUserIds },
        startDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        startDate: 'asc',
      },
    });

    console.info(
      `[Challenge ${challengeId}] Found ${activities.length} retroactive activities to count`
    );

    // Add each activity to the challenge
    for (const activity of activities) {
      try {
        // Check if activity already added
        const existing = await prisma.challengeActivity.findUnique({
          where: {
            challengeId_activityId: {
              challengeId,
              activityId: activity.id,
            },
          },
        });

        if (existing) {
          continue;
        }

        // Add activity to challenge
        await prisma.challengeActivity.create({
          data: {
            challengeId,
            userId: activity.userId,
            activityId: activity.id,
            distance: activity.distance,
            elevation: activity.totalElevationGain,
            movingTime: activity.movingTime,
            activityType: activity.type,
            recordedAt: activity.startDate,
          },
        });

        // Update participant progress
        await prisma.challengeParticipant.update({
          where: {
            challengeId_userId: {
              challengeId,
              userId: activity.userId,
            },
          },
          data: {
            totalDistance: { increment: activity.distance },
            totalElevation: { increment: activity.totalElevationGain },
            activityCount: { increment: 1 },
            lastActivityAt: activity.startDate,
          },
        });

        console.info(
          `[Challenge ${challengeId}] Added retroactive activity ${activity.id} for user ${activity.userId}`
        );
      } catch (error) {
        console.error(
          `[Challenge ${challengeId}] Error adding retroactive activity ${activity.id}:`,
          error
        );
      }
    }
  }

  /**
   * Cancel a challenge
   */
  async cancelChallenge(challengeId: string, userId: number): Promise<Challenge> {
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new Error('Challenge not found');
    }

    if (challenge.creatorId !== userId) {
      throw new Error('Only the creator can cancel this challenge');
    }

    if (challenge.status === 'completed' || challenge.status === 'failed') {
      throw new Error('Cannot cancel completed or failed challenges');
    }

    const updated = await prisma.challenge.update({
      where: { id: challengeId },
      data: { status: 'cancelled' },
      include: {
        creator: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            profile: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    // Create event
    await prisma.challengeEvent.create({
      data: {
        challengeId,
        userId,
        type: 'cancelled',
        data: {},
      },
    });

    return updated as unknown as Challenge;
  }

  /**
   * Delete a challenge (only if draft and creator)
   */
  async deleteChallenge(challengeId: string, userId: number): Promise<void> {
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new Error('Challenge not found');
    }

    if (challenge.creatorId !== userId) {
      throw new Error('Only the creator can delete this challenge');
    }

    if (challenge.status !== 'draft') {
      throw new Error('Can only delete draft challenges. Use cancel for active challenges');
    }

    await prisma.challenge.delete({
      where: { id: challengeId },
    });
  }

  /**
   * Sync all activities for active challenges
   * This recalculates all participant progress based on current activities
   */
  async syncActiveChallenges(userId: number): Promise<{
    synced: number;
    activitiesAdded: number;
  }> {
    // Get all active challenges the user is participating in
    const challenges = await prisma.challenge.findMany({
      where: {
        status: 'active',
        participants: {
          some: {
            userId,
            status: 'accepted',
          },
        },
      },
      include: {
        participants: {
          where: { status: 'accepted' },
        },
      },
    });

    console.info(
      `[Challenge Sync] Found ${challenges.length} active challenges for user ${userId}`
    );

    let totalActivitiesAdded = 0;

    for (const challenge of challenges) {
      const beforeCount = await prisma.challengeActivity.count({
        where: { challengeId: challenge.id },
      });

      await this.countRetroactiveActivities(
        challenge.id,
        challenge.startDate,
        challenge.endDate,
        challenge.participants.map((p) => p.userId)
      );

      const afterCount = await prisma.challengeActivity.count({
        where: { challengeId: challenge.id },
      });

      totalActivitiesAdded += afterCount - beforeCount;
    }

    console.info(
      `[Challenge Sync] Synced ${challenges.length} challenges, added ${totalActivitiesAdded} activities`
    );

    return {
      synced: challenges.length,
      activitiesAdded: totalActivitiesAdded,
    };
  }

  /**
   * Get challenge progress summary
   */
  async getChallengeProgress(challengeId: string): Promise<{
    totalProgress: {
      distance: number;
      elevation: number;
      activityCount: number;
    };
    targetProgress: {
      distance?: number;
      elevation?: number;
    };
    isComplete: boolean;
  }> {
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        participants: {
          where: {
            status: 'accepted',
          },
        },
      },
    });

    if (!challenge) {
      throw new Error('Challenge not found');
    }

    const targets = challenge.targets as ChallengeTargets;

    // For collaborative: sum all participants
    // For competitive: each participant individually (but we return total here)
    type ParticipantWithProgress = {
      totalDistance: number;
      totalElevation: number;
      activityCount: number;
    };

    const totalDistance = (challenge.participants as ParticipantWithProgress[]).reduce(
      (sum, p) => sum + p.totalDistance,
      0
    );
    const totalElevation = (challenge.participants as ParticipantWithProgress[]).reduce(
      (sum, p) => sum + p.totalElevation,
      0
    );
    const totalActivities = (challenge.participants as ParticipantWithProgress[]).reduce(
      (sum, p) => sum + p.activityCount,
      0
    );

    const targetProgress: { distance?: number; elevation?: number } = {};

    if (targets.distance) {
      targetProgress.distance = (totalDistance / targets.distance) * 100;
    }

    if (targets.elevation) {
      targetProgress.elevation = (totalElevation / targets.elevation) * 100;
    }

    // Check completion
    let isComplete = false;

    if (challenge.type === 'collaborative') {
      const distanceComplete = !targets.distance || totalDistance >= targets.distance;
      const elevationComplete = !targets.elevation || totalElevation >= targets.elevation;
      isComplete = distanceComplete && elevationComplete;
    }

    return {
      totalProgress: {
        distance: totalDistance,
        elevation: totalElevation,
        activityCount: totalActivities,
      },
      targetProgress,
      isComplete,
    };
  }
}

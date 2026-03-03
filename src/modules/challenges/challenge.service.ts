import { prisma } from '@shared/utils/index.js';
import type {
  Challenge,
  ChallengeTargets,
  ChallengeType,
  CompetitiveGoal,
  ParticipantStatus,
} from '@shared/types/index.js';
import type { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service.js';

interface AddedActivityInfo {
  userId: number;
  activityCount: number;
  totalDistance: number;
}

interface CountRetroactiveResult {
  totalAdded: number;
  addedByUser: Map<number, AddedActivityInfo>;
}

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

// Module-level debounce for completeExpiredChallenges
let lastCompletionCheck = 0;
const COMPLETION_CHECK_INTERVAL_MS = 60_000; // 60 seconds

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
        status: 'active',
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

    // If challenge has already started, retroactively count activities for the creator
    const targets = challengeData.targets as ChallengeTargets;
    if (challengeData.startDate <= new Date()) {
      await this.countRetroactiveActivities(
        challenge.id,
        challengeData.startDate,
        challengeData.endDate,
        [challengeData.creatorId],
        targets.activityType
      );
    }

    return challenge as unknown as Challenge;
  }

  /**
   * Get a challenge by ID
   */
  async getChallengeById(challengeId: string, userId?: number): Promise<Challenge | null> {
    // Lazily complete expired challenges
    await this.completeExpiredChallenges();

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
    // Lazily complete expired challenges
    await this.completeExpiredChallenges();

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

    if (challenge.status !== 'active') {
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
   * Count and add activities that occurred during the challenge period
   * This is called when a challenge is started to include past activities
   * Returns information about which activities were added, grouped by user
   */
  async countRetroactiveActivities(
    challengeId: string,
    startDate: Date,
    endDate: Date,
    participantUserIds: number[],
    activityType?: string
  ): Promise<CountRetroactiveResult> {
    const result: CountRetroactiveResult = {
      totalAdded: 0,
      addedByUser: new Map(),
    };

    // Remove any previously-added activities that no longer match the activity type filter.
    // This handles challenges where activities were added before a filter was set,
    // or where the filter was changed after activities were already counted.
    if (activityType) {
      const removed = await prisma.challengeActivity.deleteMany({
        where: {
          challengeId,
          activityType: { not: activityType },
        },
      });

      if (removed.count > 0) {
        console.info(
          `[Challenge ${challengeId}] Removed ${removed.count} activities not matching type "${activityType}"`
        );
      }
    }

    // Find all activities for accepted participants within the challenge date range
    const activities = await prisma.activity.findMany({
      where: {
        userId: { in: participantUserIds },
        startDate: {
          gte: startDate,
          lte: endDate,
        },
        ...(activityType && { type: activityType }),
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

        // Track added activities by user
        result.totalAdded++;
        const userInfo = result.addedByUser.get(activity.userId) || {
          userId: activity.userId,
          activityCount: 0,
          totalDistance: 0,
        };
        userInfo.activityCount++;
        userInfo.totalDistance += activity.distance;
        result.addedByUser.set(activity.userId, userInfo);

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

    // Recalculate participant totals from actual ChallengeActivity records.
    // This ensures totals are always accurate regardless of historical data issues.
    for (const userId of participantUserIds) {
      const aggregation = await prisma.challengeActivity.aggregate({
        where: {
          challengeId,
          userId,
        },
        _sum: {
          distance: true,
          elevation: true,
        },
        _count: true,
        _max: {
          recordedAt: true,
        },
      });

      await prisma.challengeParticipant.update({
        where: {
          challengeId_userId: {
            challengeId,
            userId,
          },
        },
        data: {
          totalDistance: aggregation._sum.distance || 0,
          totalElevation: aggregation._sum.elevation || 0,
          activityCount: aggregation._count,
          lastActivityAt: aggregation._max.recordedAt,
        },
      });
    }

    return result;
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
        data: {
          challengeName: challenge.name,
        },
      },
    });

    // Notify all accepted participants (except the creator who cancelled)
    const notificationsService = new NotificationsService();
    const creator = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstname: true, lastname: true },
    });
    const creatorName = creator ? `${creator.firstname} ${creator.lastname}` : 'The creator';

    const acceptedParticipants = updated.participants.filter(
      (p) => p.userId !== userId && (p.status === 'accepted' || p.status === 'invited')
    );

    for (const participant of acceptedParticipants) {
      try {
        await notificationsService.notifyChallengeCancelled(
          participant.userId,
          challenge.name,
          creatorName
        );
      } catch (error) {
        console.error(
          `[Challenge] Failed to notify user ${participant.userId} about cancellation:`,
          error
        );
      }
    }

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

    if (challenge.status !== 'active' || challenge.startDate <= new Date()) {
      throw new Error('Can only delete upcoming challenges. Use cancel for active challenges');
    }

    await prisma.challenge.delete({
      where: { id: challengeId },
    });
  }

  /**
   * Sync all activities for active challenges
   * This recalculates all participant progress based on current activities
   * Notifies other participants when the syncing user adds activities
   */
  async syncActiveChallenges(userId: number): Promise<{
    synced: number;
    activitiesAdded: number;
  }> {
    // Lazily complete expired challenges before syncing
    await this.completeExpiredChallenges();

    const notificationsService = new NotificationsService();

    // Get the syncing user's info for notifications
    const syncingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstname: true, lastname: true },
    });

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
          include: {
            user: {
              select: { id: true, firstname: true },
            },
          },
        },
      },
    });

    console.info(
      `[Challenge Sync] Found ${challenges.length} active challenges for user ${userId}`
    );

    let totalActivitiesAdded = 0;

    for (const challenge of challenges) {
      const challengeTargets = challenge.targets as ChallengeTargets;
      const result = await this.countRetroactiveActivities(
        challenge.id,
        challenge.startDate,
        challenge.endDate,
        challenge.participants.map((p) => p.userId),
        challengeTargets.activityType
      );

      totalActivitiesAdded += result.totalAdded;

      // For collaborative challenges, check if target was just reached
      if (result.totalAdded > 0 && challenge.type === 'collaborative') {
        const progress = await this.getChallengeProgress(challenge.id);
        if (progress.isComplete) {
          // Check if there's already a milestone_reached event for this challenge
          const existingMilestone = await prisma.challengeEvent.findFirst({
            where: {
              challengeId: challenge.id,
              type: 'milestone_reached',
              data: { path: ['milestone'], equals: 'target_reached' },
            },
          });

          if (!existingMilestone) {
            await prisma.challengeEvent.create({
              data: {
                challengeId: challenge.id,
                userId,
                type: 'milestone_reached',
                data: {
                  milestone: 'target_reached',
                  challengeName: challenge.name,
                },
              },
            });

            for (const participant of challenge.participants) {
              try {
                await notificationsService.notifyChallengeProgress(
                  participant.userId,
                  challenge.name,
                  'Target reached! Keep going until the end!'
                );
              } catch (error) {
                console.error(
                  `[Challenge Sync] Failed to notify user ${participant.userId} about milestone:`,
                  error
                );
              }
            }
          }
        }
      }

      // Check if the syncing user added any activities
      const userAddedInfo = result.addedByUser.get(userId);

      if (userAddedInfo && userAddedInfo.activityCount > 0 && syncingUser) {
        // Notify other participants in this challenge
        const otherParticipants = challenge.participants.filter((p) => p.userId !== userId);

        console.info(
          `[Challenge Sync] User ${userId} added ${userAddedInfo.activityCount} activities to challenge "${challenge.name}", notifying ${otherParticipants.length} other participant(s)`
        );

        for (const participant of otherParticipants) {
          try {
            await notificationsService.notifyChallengeActivityAdded(
              participant.userId,
              challenge.name,
              `${syncingUser.firstname} ${syncingUser.lastname}`,
              userAddedInfo.activityCount,
              userAddedInfo.totalDistance
            );
          } catch (error) {
            console.error(`[Challenge Sync] Failed to notify user ${participant.userId}:`, error);
          }
        }
      }
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

  /**
   * Lazily complete expired challenges (endDate < now and still active)
   * Called before fetching challenges to ensure status is up to date
   */
  async completeExpiredChallenges(): Promise<void> {
    const nowMs = Date.now();
    if (nowMs - lastCompletionCheck < COMPLETION_CHECK_INTERVAL_MS) {
      return;
    }
    lastCompletionCheck = nowMs;

    const now = new Date();

    const expiredChallenges = await prisma.challenge.findMany({
      where: {
        status: 'active',
        endDate: { lt: now },
      },
      include: {
        participants: {
          where: { status: 'accepted' },
        },
      },
    });

    if (expiredChallenges.length === 0) {
      return;
    }

    const notificationsService = new NotificationsService();

    for (const challenge of expiredChallenges) {
      const targets = challenge.targets as ChallengeTargets;

      // Determine if challenge succeeded
      let isSuccess = true;

      if (challenge.type === 'collaborative') {
        const totalDistance = challenge.participants.reduce((sum, p) => sum + p.totalDistance, 0);
        const totalElevation = challenge.participants.reduce((sum, p) => sum + p.totalElevation, 0);

        const distanceComplete = !targets.distance || totalDistance >= targets.distance;
        const elevationComplete = !targets.elevation || totalElevation >= targets.elevation;
        isSuccess = distanceComplete && elevationComplete;
      }
      // Competitive challenges always complete as 'completed' (there's a winner)

      const newStatus = isSuccess ? 'completed' : 'failed';

      await prisma.challenge.update({
        where: { id: challenge.id },
        data: { status: newStatus },
      });

      // Create event
      await prisma.challengeEvent.create({
        data: {
          challengeId: challenge.id,
          type: newStatus,
          data: {
            challengeName: challenge.name,
            isSuccess,
          },
        },
      });

      // Notify all participants
      for (const participant of challenge.participants) {
        try {
          await notificationsService.notifyChallengeCompleted(
            participant.userId,
            challenge.name,
            isSuccess
          );
        } catch (error) {
          console.error(
            `[Challenge] Failed to notify user ${participant.userId} about challenge completion:`,
            error
          );
        }
      }

      console.info(
        `[Challenge] Auto-completed challenge "${challenge.name}" (${challenge.id}) as ${newStatus}`
      );
    }
  }

  /**
   * Get completed challenges the user hasn't seen the summary for yet
   */
  async getUnseenCompletedChallenges(userId: number): Promise<Challenge[]> {
    const participants = await prisma.challengeParticipant.findMany({
      where: {
        userId,
        status: 'accepted',
        summarySeenAt: null,
        challenge: {
          status: { in: ['completed', 'failed'] },
        },
      },
      include: {
        challenge: {
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
        },
      },
      orderBy: {
        challenge: {
          endDate: 'desc',
        },
      },
    });

    return participants.map((p) => p.challenge) as unknown as Challenge[];
  }

  /**
   * Mark a challenge summary as seen by a user
   */
  async markChallengeSummarySeen(challengeId: string, userId: number): Promise<void> {
    await prisma.challengeParticipant.update({
      where: {
        challengeId_userId: {
          challengeId,
          userId,
        },
      },
      data: {
        summarySeenAt: new Date(),
      },
    });
  }
}

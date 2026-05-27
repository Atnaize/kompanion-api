import { prisma, tryClaimRun, recordRunResult } from '@shared/utils/index.js';
import type {
  Challenge,
  ChallengeTargets,
  ChallengeType,
  CompetitiveGoal,
  ParticipantStatus,
} from '@shared/types/index.js';
import type { Prisma } from '@prisma/client';
import { notificationEmitter } from '../inbox/index.js';
import { activityDigestService, type DigestActivity } from '../chat/index.js';
import { FriendsService } from '../friends/friends.service.js';
import { logger } from '@shared/logger/index.js';

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
  /**
   * Optional club to attach this challenge to. When set, the creator must be
   * an active member of the club, and every invitee must also be an active
   * member (we don't pull random friends into a club's challenge — that
   * would be a back-door into the club's leaderboard).
   */
  clubId?: string;
}

interface UpdateChallengeData {
  name?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  targets?: ChallengeTargets;
}

// Debounce window for the lazy `completeExpiredChallenges` sweep. Backed by
// a Postgres-level guard (see tryClaimRun) so it survives serverless cold
// starts and is safe across concurrent invocations.
const COMPLETION_CHECK_INTERVAL_MS = 60_000;
const COMPLETION_JOB_NAME = 'complete_expired_challenges';

export class ChallengeService {
  private friendsService = new FriendsService();

  /**
   * Create a new challenge
   *
   * The challenge row + its participants + the initial "created" event are
   * inserted atomically — partial state (e.g. challenge with no participants
   * because participant create failed) would corrupt downstream invariants.
   *
   * The retroactive activity backfill is kept OUTSIDE the transaction. It
   * can be heavy (scans Activity by date range) and is idempotent: failing
   * later just means the creator's pre-existing activities aren't counted
   * yet, fixable on next sync. Keeping it inside would hold a write tx open
   * for seconds and risk Pg statement_timeout.
   */
  async createChallenge(data: CreateChallengeData): Promise<Challenge> {
    const { invitedUserIds, ...challengeData } = data;

    if (challengeData.startDate >= challengeData.endDate) {
      throw new Error('Start date must be before end date');
    }
    if (challengeData.type === 'competitive' && !challengeData.competitiveGoal) {
      throw new Error('Competitive challenges must have a competitive goal');
    }
    if (challengeData.type === 'collaborative' && challengeData.competitiveGoal) {
      throw new Error('Collaborative challenges cannot have a competitive goal');
    }

    // Club-scoped challenges have stricter invitee rules than friend-only ones:
    // every invitee must already be a club member. Friendship checks are
    // skipped in that path because club membership implies "knows each other".
    if (challengeData.clubId) {
      await this.assertClubMembership(challengeData.creatorId, challengeData.clubId);
      if (invitedUserIds && invitedUserIds.length > 0) {
        await this.assertAllClubMembers(challengeData.clubId, invitedUserIds);
      }
    } else if (invitedUserIds && invitedUserIds.length > 0) {
      await this.friendsService.assertAllFriends(challengeData.creatorId, invitedUserIds);
    }

    const challenge = await prisma.$transaction(async (tx) => {
      const created = await tx.challenge.create({
        data: {
          ...challengeData,
          status: 'active',
          targets: challengeData.targets as Prisma.InputJsonValue,
          participants: {
            create: [
              {
                userId: challengeData.creatorId,
                status: 'accepted',
                acceptedAt: new Date(),
              },
              ...(invitedUserIds || []).map((userId) => ({
                userId,
                status: 'invited' as ParticipantStatus,
              })),
            ],
          },
        },
        include: {
          creator: {
            select: { id: true, firstname: true, lastname: true, profile: true },
          },
          participants: {
            include: {
              user: {
                select: { id: true, firstname: true, lastname: true, profile: true },
              },
            },
          },
        },
      });

      await tx.challengeEvent.create({
        data: {
          challengeId: created.id,
          userId: challengeData.creatorId,
          type: 'created',
          data: {
            challengeName: created.name,
            invitedCount: invitedUserIds?.length || 0,
          },
        },
      });

      return created;
    });

    // Retroactive backfill — best-effort, post-commit (see jsdoc).
    if (challengeData.startDate <= new Date()) {
      await this.countRetroactiveActivities(
        challenge.id,
        challengeData.startDate,
        challengeData.endDate,
        [challengeData.creatorId],
        challengeData.targets.activityType
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
        club: {
          select: { id: true, name: true },
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
      /**
       * When set, lists challenges attached to this club instead of just the
       * viewer's participating ones. The viewer must be an active club member.
       */
      clubId?: string;
    }
  ): Promise<Challenge[]> {
    // Lazily complete expired challenges
    await this.completeExpiredChallenges();

    if (filters?.clubId) {
      await this.assertClubMembership(userId, filters.clubId);
    }

    const where: Prisma.ChallengeWhereInput = filters?.clubId
      ? {
          clubId: filters.clubId,
          ...(filters?.status && { status: filters.status }),
          ...(filters?.type && { type: filters.type }),
        }
      : {
          participants: {
            some: {
              userId,
              status: { in: ['accepted', 'invited'] },
            },
          },
          ...(filters?.status && { status: filters.status }),
          ...(filters?.type && { type: filters.type }),
        };

    const challenges = await prisma.challenge.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            profile: true,
          },
        },
        // Lightweight club hint so cards in the challenges list can show
        // "from <Club>" without an extra fetch.
        club: {
          select: { id: true, name: true },
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

    // Collected for the chat activity_digest write below. Only includes
    // activities that we actually inserted (skipping pre-existing rows), so
    // resyncs don't produce duplicate digest entries.
    const digestEntries: DigestActivity[] = [];

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

        digestEntries.push({
          userId: activity.userId,
          activityId: String(activity.id),
          type: activity.type,
          name: activity.name,
          distance: activity.distance,
          movingTime: activity.movingTime,
          elevation: activity.totalElevationGain,
          // startDateLocal is the activity's local calendar timestamp — exactly
          // what we want for grouping into "today's runs" cards.
          recordedAt: activity.startDateLocal.toISOString(),
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

    // Fire-and-forget chat digest. Failures here must not poison the sync
    // (the activities are already counted toward challenge progress).
    if (digestEntries.length > 0) {
      void activityDigestService
        .recordForChallenge({ challengeId, activities: digestEntries })
        .catch((err) =>
          console.error(`[Chat] activity digest write failed for challenge ${challengeId}:`, err)
        );
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
    const creator = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstname: true, lastname: true },
    });
    const creatorName = creator ? `${creator.firstname} ${creator.lastname}` : 'The creator';

    const acceptedParticipants = updated.participants.filter(
      (p) => p.userId !== userId && (p.status === 'accepted' || p.status === 'invited')
    );

    await Promise.allSettled(
      acceptedParticipants.map((participant) =>
        notificationEmitter
          .record(
            participant.userId,
            {
              type: 'challenge_cancelled',
              entityType: 'challenge',
              entityId: challenge.id,
              metadata: { challengeName: challenge.name, cancelledByName: creatorName },
            },
            { actorId: userId }
          )
          .catch((err) =>
            console.error(
              `[Inbox] challenge_cancelled emit failed for user ${participant.userId}:`,
              err
            )
          )
      )
    );

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

            await Promise.allSettled(
              challenge.participants.map((participant) =>
                notificationEmitter
                  .record(participant.userId, {
                    type: 'challenge_progress',
                    entityType: 'challenge',
                    entityId: challenge.id,
                    metadata: {
                      challengeName: challenge.name,
                      milestone: 'Target reached! Keep going until the end!',
                    },
                  })
                  .catch((err) =>
                    console.error(
                      `[Inbox] challenge_progress emit failed for user ${participant.userId}:`,
                      err
                    )
                  )
              )
            );
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

        await Promise.allSettled(
          otherParticipants.map((participant) =>
            notificationEmitter
              .record(
                participant.userId,
                {
                  type: 'challenge_activity_added',
                  entityType: 'challenge',
                  entityId: challenge.id,
                  metadata: {
                    challengeName: challenge.name,
                    participantName: `${syncingUser.firstname} ${syncingUser.lastname}`,
                    activityCount: userAddedInfo.activityCount,
                    totalDistance: userAddedInfo.totalDistance,
                  },
                },
                { actorId: userId }
              )
              .catch((err) =>
                console.error(
                  `[Inbox] challenge_activity_added emit failed for user ${participant.userId}:`,
                  err
                )
              )
          )
        );
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
  async completeExpiredChallenges(options?: { force?: boolean }): Promise<void> {
    // Cross-process debounce. `force: true` bypasses it for the QStash-
    // scheduled worker path; lazy callers from request handlers leave it off
    // so we don't run the sweep more than once per minute across the fleet.
    if (!options?.force) {
      const claimed = await tryClaimRun(COMPLETION_JOB_NAME, COMPLETION_CHECK_INTERVAL_MS);
      if (!claimed) return;
    }

    const now = new Date();

    let expiredChallenges;
    try {
      expiredChallenges = await prisma.challenge.findMany({
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
    } catch (err) {
      await recordRunResult(COMPLETION_JOB_NAME, 'error');
      logger.error({ err }, '[Challenge] expired-challenges query failed');
      throw err;
    }

    if (expiredChallenges.length === 0) {
      await recordRunResult(COMPLETION_JOB_NAME, 'ok');
      return;
    }

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
      await Promise.allSettled(
        challenge.participants.map((participant) =>
          notificationEmitter
            .record(participant.userId, {
              type: 'challenge_completed',
              entityType: 'challenge',
              entityId: challenge.id,
              metadata: { challengeName: challenge.name, isSuccess },
            })
            .catch((err) =>
              logger.error(
                { err, userId: participant.userId, challengeId: challenge.id },
                '[Inbox] challenge_completed emit failed'
              )
            )
        )
      );

      logger.info(
        { challengeId: challenge.id, name: challenge.name, status: newStatus },
        '[Challenge] auto-completed'
      );
    }

    await recordRunResult(COMPLETION_JOB_NAME, 'ok');
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

  /**
   * Throws if the user isn't an active member of the given club. Used to gate
   * club-scoped challenge create and list operations.
   */
  private async assertClubMembership(userId: number, clubId: string): Promise<void> {
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId } },
      select: { status: true },
    });
    if (!membership || membership.status !== 'active') {
      throw new Error('FORBIDDEN: not a club member');
    }
  }

  /**
   * Asserts every userId is an active member of the club. Used when inviting
   * to a club-scoped challenge — friendship is not enough, you must already
   * be in the crew.
   */
  private async assertAllClubMembers(clubId: string, userIds: number[]): Promise<void> {
    if (userIds.length === 0) return;
    const rows = await prisma.clubMember.findMany({
      where: { clubId, userId: { in: userIds }, status: 'active' },
      select: { userId: true },
    });
    const memberIds = new Set(rows.map((r) => r.userId));
    const strangers = userIds.filter((id) => !memberIds.has(id));
    if (strangers.length > 0) {
      throw new Error('Only club members can be invited to this challenge');
    }
  }
}

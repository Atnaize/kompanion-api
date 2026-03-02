import { prisma } from '@shared/utils/index.js';
import type { ChallengeParticipant, ChallengeTargets } from '@shared/types/index.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ChallengeService } from './challenge.service.js';

export class InvitationService {
  private notificationsService = new NotificationsService();
  private challengeService = new ChallengeService();

  /**
   * Invite users to a challenge
   */
  async inviteUsers(challengeId: string, creatorId: number, userIds: number[]): Promise<void> {
    // Verify the user is the creator
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new Error('Challenge not found');
    }

    if (challenge.creatorId !== creatorId) {
      throw new Error('Only the creator can invite users');
    }

    if (challenge.status !== 'active') {
      throw new Error('Cannot invite users to completed or cancelled challenges');
    }

    // Filter out users already invited or participating
    const existingParticipants = await prisma.challengeParticipant.findMany({
      where: {
        challengeId,
        userId: { in: userIds },
      },
      select: { userId: true },
    });

    const existingUserIds = new Set(existingParticipants.map((p) => p.userId));
    const newUserIds = userIds.filter((id) => !existingUserIds.has(id));

    if (newUserIds.length === 0) {
      throw new Error('All users are already invited or participating');
    }

    // Create invitations
    await prisma.challengeParticipant.createMany({
      data: newUserIds.map((userId) => ({
        challengeId,
        userId,
        status: 'invited',
      })),
    });

    // Create events for each invitation
    await Promise.all(
      newUserIds.map((userId) =>
        prisma.challengeEvent.create({
          data: {
            challengeId,
            userId: creatorId,
            type: 'invited',
            data: {
              invitedUserId: userId,
              challengeName: challenge.name,
            },
          },
        })
      )
    );

    // Send push notifications to invited users
    const creator = await prisma.user.findUnique({
      where: { id: creatorId },
      select: { firstname: true, lastname: true },
    });

    const creatorName = creator ? `${creator.firstname} ${creator.lastname}` : 'Someone';

    await Promise.allSettled(
      newUserIds.map((userId) =>
        this.notificationsService
          .notifyChallengeInvite(userId, challenge.name, creatorName)
          .catch((error) => {
            console.error(`[Notifications] Error sending invitation to user ${userId}:`, error);
          })
      )
    );
  }

  /**
   * Accept a challenge invitation
   */
  async acceptInvitation(challengeId: string, userId: number): Promise<ChallengeParticipant> {
    const participant = await prisma.challengeParticipant.findUnique({
      where: {
        challengeId_userId: {
          challengeId,
          userId,
        },
      },
    });

    if (!participant) {
      throw new Error('Invitation not found');
    }

    if (participant.status !== 'invited') {
      throw new Error('Invitation has already been responded to');
    }

    // Check if challenge is still joinable
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new Error('Challenge not found');
    }

    if (challenge.status !== 'active') {
      throw new Error('Cannot accept invitation for completed or cancelled challenges');
    }

    const updated = await prisma.challengeParticipant.update({
      where: {
        challengeId_userId: {
          challengeId,
          userId,
        },
      },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
      },
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
    });

    // Create event
    await prisma.challengeEvent.create({
      data: {
        challengeId,
        userId,
        type: 'created', // Reuse created type
        data: {
          action: 'invitation_accepted',
          userName: `${updated.user.firstname} ${updated.user.lastname}`,
        },
      },
    });

    // Backfill activities if challenge has already started
    if (challenge.startDate <= new Date()) {
      const targets = challenge.targets as ChallengeTargets;
      await this.challengeService.countRetroactiveActivities(
        challengeId,
        challenge.startDate,
        challenge.endDate,
        [userId],
        targets.activityType
      );
    }

    return updated as unknown as ChallengeParticipant;
  }

  /**
   * Decline a challenge invitation
   */
  async declineInvitation(challengeId: string, userId: number): Promise<void> {
    const participant = await prisma.challengeParticipant.findUnique({
      where: {
        challengeId_userId: {
          challengeId,
          userId,
        },
      },
    });

    if (!participant) {
      throw new Error('Invitation not found');
    }

    if (participant.status !== 'invited') {
      throw new Error('Invitation has already been responded to');
    }

    await prisma.challengeParticipant.update({
      where: {
        challengeId_userId: {
          challengeId,
          userId,
        },
      },
      data: {
        status: 'declined',
      },
    });

    // No event needed for declines (private action)
  }

  /**
   * Leave a challenge
   */
  async leaveChallenge(challengeId: string, userId: number): Promise<void> {
    const participant = await prisma.challengeParticipant.findUnique({
      where: {
        challengeId_userId: {
          challengeId,
          userId,
        },
      },
      include: {
        challenge: true,
      },
    });

    if (!participant) {
      throw new Error('You are not a participant in this challenge');
    }

    if (participant.status !== 'accepted') {
      throw new Error('You must be an accepted participant to leave');
    }

    // Creator cannot leave their own challenge
    if (participant.challenge.creatorId === userId) {
      throw new Error('Challenge creator cannot leave. Cancel the challenge instead.');
    }

    // Cannot leave completed challenges
    if (participant.challenge.status === 'completed' || participant.challenge.status === 'failed') {
      throw new Error('Cannot leave completed or failed challenges');
    }

    await prisma.challengeParticipant.update({
      where: {
        challengeId_userId: {
          challengeId,
          userId,
        },
      },
      data: {
        status: 'left',
      },
    });

    // Create event
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstname: true,
        lastname: true,
      },
    });

    await prisma.challengeEvent.create({
      data: {
        challengeId,
        userId,
        type: 'created', // Reuse created type
        data: {
          action: 'user_left',
          userName: user ? `${user.firstname} ${user.lastname}` : 'User',
        },
      },
    });
  }

  /**
   * Get pending invitations for a user
   */
  async getPendingInvitations(userId: number): Promise<ChallengeParticipant[]> {
    const invitations = await prisma.challengeParticipant.findMany({
      where: {
        userId,
        status: 'invited',
        challenge: {
          status: 'active',
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
              where: {
                status: 'accepted',
              },
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
        },
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
        invitedAt: 'desc',
      },
    });

    return invitations as unknown as ChallengeParticipant[];
  }
}

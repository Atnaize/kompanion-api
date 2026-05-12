import { prisma } from '@shared/utils/index.js';
import { FriendsService, type FriendshipState } from '../friends/friends.service.js';

export interface UserProfile {
  user: {
    id: number;
    stravaId: number;
    firstname: string;
    lastname: string;
    profile: string;
    profileMedium: string;
  };
  friendshipState: FriendshipState;
  /**
   * Aggregate counts visible to any logged-in user.
   * (Always returned — these are not privacy-sensitive.)
   */
  counters: {
    friends: number;
  };
  /**
   * Detailed stats. Only returned when viewer is `self` or `friends`.
   */
  stats?: {
    totalActivities: number;
    totalDistance: number;
    totalElevation: number;
  };
}

export class UsersService {
  private friendsService = new FriendsService();

  /**
   * Returns a user's profile. The shape branches on viewer relationship:
   * - self / friends → full stats included
   * - pending_outgoing / pending_incoming / none → minimal stub
   *
   * Either way the response includes `friendshipState` so the UI knows which
   * action button to render.
   */
  async getProfile(viewerId: number, targetId: number): Promise<UserProfile> {
    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        stravaId: true,
        firstname: true,
        lastname: true,
        profile: true,
        profileMedium: true,
      },
    });
    if (!user) {
      throw new Error('User not found');
    }

    const friendshipState = await this.friendsService.getFriendshipState(viewerId, targetId);

    const friendsCount = await prisma.friendship.count({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: targetId }, { addresseeId: targetId }],
      },
    });

    const profile: UserProfile = {
      user,
      friendshipState,
      counters: { friends: friendsCount },
    };

    if (friendshipState === 'self' || friendshipState === 'friends') {
      const stats = await prisma.userStats.findUnique({
        where: { userId: targetId },
        select: {
          totalActivities: true,
          totalDistance: true,
          totalElevation: true,
        },
      });
      profile.stats = stats ?? {
        totalActivities: 0,
        totalDistance: 0,
        totalElevation: 0,
      };
    }

    return profile;
  }
}

import { prisma } from '@shared/utils/index.js';

interface KompanionFriend {
  id: number;
  stravaId: number;
  firstname: string;
  lastname: string;
  profile: string;
  profileMedium: string;
}

export class FriendsService {
  /**
   * Search Kompanion users by name
   * Used for inviting users to challenges
   */
  async searchUsers(query: string, currentUserId: number): Promise<KompanionFriend[]> {
    if (query.length < 2) {
      throw new Error('Search query must be at least 2 characters');
    }

    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            id: {
              not: currentUserId,
            },
          },
          {
            OR: [
              {
                firstname: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
              {
                lastname: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
              {
                username: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
            ],
          },
        ],
      },
      select: {
        id: true,
        stravaId: true,
        firstname: true,
        lastname: true,
        profile: true,
        profileMedium: true,
      },
      take: 20,
    });

    return users.map((user) => ({
      id: user.id,
      stravaId: user.stravaId,
      firstname: user.firstname,
      lastname: user.lastname,
      profile: user.profile,
      profileMedium: user.profileMedium,
    }));
  }
}

import { prisma } from '@shared/utils/index.js';
import type { Quest, QuestObjective } from '@shared/types/index.js';

export class QuestsService {
  /**
   * Get active quests for a user
   * Automatically creates quest instances for active quest templates
   */
  async getUserQuests(userId: number): Promise<Quest[]> {
    const now = new Date();

    // Get weekly quest templates
    const weeklyTemplates = await prisma.quest.findMany({
      where: { type: 'weekly' },
      include: { objectives: true },
    });

    // Get or create user quest instances
    const userQuests: Quest[] = [];

    for (const template of weeklyTemplates) {
      const questInstance = await this.getOrCreateUserQuest(userId, template.id, now);
      const questWithProgress = await this.calculateQuestProgress(userId, questInstance);
      userQuests.push(questWithProgress);
    }

    return userQuests;
  }

  /**
   * Get a specific quest for a user
   */
  async getUserQuest(userId: number, questId: string): Promise<Quest | null> {
    const template = await prisma.quest.findUnique({
      where: { id: questId },
      include: { objectives: true },
    });

    if (!template) {
      return null;
    }

    const questInstance = await this.getOrCreateUserQuest(userId, questId, new Date());
    return this.calculateQuestProgress(userId, questInstance);
  }

  /**
   * Get or create a user quest instance for the current period
   */
  private async getOrCreateUserQuest(
    userId: number,
    questId: string,
    now: Date
  ): Promise<{
    id: number;
    userId: number;
    questId: string;
    status: string;
    progress: unknown;
    startedAt: Date;
    completedAt: Date | null;
  }> {
    // For weekly quests, check if there's an active quest for this week
    const startOfWeek = this.getStartOfWeek(now);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    // Find existing quest instance for this period
    let userQuest = await prisma.userQuest.findFirst({
      where: {
        userId,
        questId,
        startedAt: {
          gte: startOfWeek,
          lt: endOfWeek,
        },
      },
    });

    // Create new instance if doesn't exist
    if (!userQuest) {
      userQuest = await prisma.userQuest.create({
        data: {
          userId,
          questId,
          status: 'active',
          progress: {},
          startedAt: startOfWeek,
        },
      });
    }

    // Check if quest expired
    if (now >= endOfWeek && userQuest.status === 'active') {
      userQuest = await prisma.userQuest.update({
        where: { id: userQuest.id },
        data: { status: 'expired' },
      });
    }

    return userQuest;
  }

  /**
   * Calculate quest progress from user activities
   */
  private async calculateQuestProgress(
    userId: number,
    userQuest: {
      id: number;
      userId: number;
      questId: string;
      status: string;
      progress: unknown;
      startedAt: Date;
      completedAt: Date | null;
    }
  ): Promise<Quest> {
    const template = await prisma.quest.findUniqueOrThrow({
      where: { id: userQuest.questId },
      include: { objectives: true },
    });

    // Calculate end date (for weekly quests, 7 days from start)
    const endDate = new Date(userQuest.startedAt);
    endDate.setDate(userQuest.startedAt.getDate() + 7);

    // Get activities for the quest period
    const activities = await prisma.activity.findMany({
      where: {
        userId,
        startDate: {
          gte: userQuest.startedAt,
          lt: endDate,
        },
      },
    });

    // Calculate objective progress
    const objectives: QuestObjective[] = template.objectives.map((objective) => {
      let current = 0;

      switch (objective.type) {
        case 'distance':
          current = activities
            .filter((a) => !objective.activityType || a.type === objective.activityType)
            .reduce((sum, a) => sum + a.distance, 0);
          break;

        case 'elevation':
          current = activities
            .filter((a) => !objective.activityType || a.type === objective.activityType)
            .reduce((sum, a) => sum + a.totalElevationGain, 0);
          break;

        case 'activities':
          current = activities.filter(
            (a) => !objective.activityType || a.type === objective.activityType
          ).length;
          break;

        case 'time':
          current = activities
            .filter((a) => !objective.activityType || a.type === objective.activityType)
            .reduce((sum, a) => sum + a.movingTime, 0);
          break;
      }

      return {
        id: objective.id,
        description: objective.description,
        type: objective.type as QuestObjective['type'],
        target: objective.target,
        current: Math.round(current),
        activityType: objective.activityType || undefined,
        completed: current >= objective.target,
      };
    });

    // Check if all objectives completed
    const allCompleted = objectives.every((obj) => obj.completed);

    // Update quest status if completed
    if (allCompleted && userQuest.status === 'active') {
      await prisma.userQuest.update({
        where: { id: userQuest.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: { objectives } as unknown as Record<string, never>,
        },
      });

      userQuest.status = 'completed';
      userQuest.completedAt = new Date();
    }

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      startDate: userQuest.startedAt.toISOString(),
      endDate: endDate.toISOString(),
      type: template.type as Quest['type'],
      objectives,
      rewards: {
        xp: template.rewardXp,
        achievements: (template.rewardAchievements as string[]) || undefined,
      },
      status: userQuest.status as Quest['status'],
    };
  }

  /**
   * Get start of week (Sunday 00:00:00)
   */
  private getStartOfWeek(date: Date): Date {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }

  /**
   * Get completed quests for a user
   */
  async getCompletedQuests(userId: number): Promise<Quest[]> {
    const completedUserQuests = await prisma.userQuest.findMany({
      where: {
        userId,
        status: 'completed',
      },
      orderBy: { completedAt: 'desc' },
      take: 10, // Last 10 completed quests
    });

    const quests: Quest[] = [];

    for (const userQuest of completedUserQuests) {
      const quest = await this.calculateQuestProgress(userId, userQuest);
      quests.push(quest);
    }

    return quests;
  }
}

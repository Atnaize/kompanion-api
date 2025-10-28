/**
 * Quest Definitions
 * Single source of truth for all quests in the app
 *
 * Quests are time-based challenges that reset periodically
 */

export interface QuestObjectiveDefinition {
  id: string;
  description: string;
  type: 'distance' | 'elevation' | 'activities' | 'time';
  target: number;
  activityType?: string;
}

export interface QuestDefinition {
  id: string;
  name: string;
  description: string;
  type: 'weekly' | 'monthly' | 'special';
  durationDays: number; // How long the quest lasts
  rewardXp: number;
  rewardAchievements?: string[]; // Achievement IDs to unlock on completion
  objectives: QuestObjectiveDefinition[];
}

export const QUEST_TEMPLATES: QuestDefinition[] = [
  // Weekly Quests
  {
    id: 'weekly-warrior',
    name: '⚔️ Weekly Warrior',
    description: 'Complete your weekly fitness goals',
    type: 'weekly',
    durationDays: 7,
    rewardXp: 100,
    objectives: [
      {
        id: 'weekly-warrior-activities',
        description: 'Complete 3 activities',
        type: 'activities',
        target: 3,
      },
      {
        id: 'weekly-warrior-distance',
        description: 'Cover 25 kilometers',
        type: 'distance',
        target: 25000, // meters
      },
    ],
  },
  {
    id: 'weekend-explorer',
    name: '🗺️ Weekend Explorer',
    description: 'Stay active during the weekend',
    type: 'weekly',
    durationDays: 7,
    rewardXp: 75,
    objectives: [
      {
        id: 'weekend-explorer-activities',
        description: 'Complete 1 activity on Saturday or Sunday',
        type: 'activities',
        target: 1,
      },
    ],
  },

  // Monthly Quests
  {
    id: 'monthly-marathon',
    name: '🏃 Monthly Marathon',
    description: 'Run or walk the distance of a marathon this month',
    type: 'monthly',
    durationDays: 30,
    rewardXp: 500,
    objectives: [
      {
        id: 'monthly-marathon-distance',
        description: 'Cover 42.2 kilometers running or walking',
        type: 'distance',
        target: 42200, // meters
        activityType: 'Run',
      },
    ],
  },
  {
    id: 'monthly-century',
    name: '🚴 Monthly Century',
    description: 'Ride 100 kilometers this month',
    type: 'monthly',
    durationDays: 30,
    rewardXp: 500,
    objectives: [
      {
        id: 'monthly-century-distance',
        description: 'Cover 100 kilometers cycling',
        type: 'distance',
        target: 100000, // meters
        activityType: 'Ride',
      },
    ],
  },
  {
    id: 'monthly-climber',
    name: '⛰️ Monthly Climber',
    description: 'Climb the height of a mountain this month',
    type: 'monthly',
    durationDays: 30,
    rewardXp: 400,
    objectives: [
      {
        id: 'monthly-climber-elevation',
        description: 'Climb 2,000 meters total',
        type: 'elevation',
        target: 2000,
      },
    ],
  },
  {
    id: 'monthly-consistency',
    name: '📅 Monthly Consistency',
    description: 'Stay active throughout the month',
    type: 'monthly',
    durationDays: 30,
    rewardXp: 600,
    objectives: [
      {
        id: 'monthly-consistency-activities',
        description: 'Complete 20 activities',
        type: 'activities',
        target: 20,
      },
    ],
  },

  // Special Quests
  {
    id: 'new-year-resolution',
    name: '🎉 New Year Resolution',
    description: 'Start the year strong with a fitness challenge',
    type: 'special',
    durationDays: 31,
    rewardXp: 1000,
    rewardAchievements: ['year-legend'],
    objectives: [
      {
        id: 'new-year-activities',
        description: 'Complete 15 activities in January',
        type: 'activities',
        target: 15,
      },
      {
        id: 'new-year-distance',
        description: 'Cover 100 kilometers in January',
        type: 'distance',
        target: 100000,
      },
    ],
  },
  {
    id: 'summer-challenge',
    name: '☀️ Summer Challenge',
    description: 'Make the most of the summer weather',
    type: 'special',
    durationDays: 90,
    rewardXp: 2000,
    objectives: [
      {
        id: 'summer-activities',
        description: 'Complete 50 outdoor activities',
        type: 'activities',
        target: 50,
      },
      {
        id: 'summer-distance',
        description: 'Cover 500 kilometers',
        type: 'distance',
        target: 500000,
      },
    ],
  },
];

/**
 * Generate a unique quest instance ID based on template and start date
 */
export function generateQuestInstanceId(templateId: string, startDate: Date): string {
  const dateStr = startDate.toISOString().split('T')[0];
  return `${templateId}-${dateStr}`;
}

/**
 * Calculate quest end date based on start date and duration
 */
export function calculateQuestEndDate(startDate: Date, durationDays: number): Date {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationDays);
  return endDate;
}

/**
 * Get active quest templates for current period
 * This can be customized to show different quests based on date/season
 */
export function getActiveQuestTemplates(): QuestDefinition[] {
  const now = new Date();
  const month = now.getMonth();

  // Always show weekly and monthly quests
  const activeQuests = QUEST_TEMPLATES.filter((q) => q.type === 'weekly' || q.type === 'monthly');

  // Add seasonal special quests
  if (month === 0) {
    // January - New Year Resolution
    activeQuests.push(QUEST_TEMPLATES.find((q) => q.id === 'new-year-resolution')!);
  } else if ([5, 6, 7].includes(month)) {
    // June, July, August - Summer Challenge
    activeQuests.push(QUEST_TEMPLATES.find((q) => q.id === 'summer-challenge')!);
  }

  return activeQuests;
}

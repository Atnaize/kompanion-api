/**
 * Achievement Definitions
 * Single source of truth for all achievements in the app
 */

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  requirementType: 'distance' | 'elevation' | 'activities' | 'speed' | 'streak';
  requirementValue: number;
  activityType?: string;
  isSecret?: boolean;
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  // First Steps
  {
    id: 'first-steps',
    name: 'First Steps',
    description: 'Complete your first activity',
    icon: '🏃',
    rarity: 'common',
    requirementType: 'activities',
    requirementValue: 1,
  },

  // Distance Achievements
  {
    id: 'kilometer-master',
    name: 'Kilometer Master',
    description: 'Cover a total of 100 kilometers',
    icon: '📏',
    rarity: 'common',
    requirementType: 'distance',
    requirementValue: 100000, // meters
  },
  {
    id: 'century-club',
    name: 'Century Club',
    description: 'Cover a total of 1,000 kilometers',
    icon: '💯',
    rarity: 'rare',
    requirementType: 'distance',
    requirementValue: 1000000, // meters
  },
  {
    id: 'ultra-distance',
    name: 'Ultra Distance',
    description: 'Cover a total of 5,000 kilometers',
    icon: '🌍',
    rarity: 'epic',
    requirementType: 'distance',
    requirementValue: 5000000, // meters
  },
  {
    id: 'around-the-world',
    name: 'Around the World',
    description: "Cover a total of 40,075 kilometers (Earth's circumference)",
    icon: '🚀',
    rarity: 'legendary',
    requirementType: 'distance',
    requirementValue: 40075000, // meters
  },

  // Elevation Achievements
  {
    id: 'hill-climber',
    name: 'Hill Climber',
    description: 'Climb a total of 1,000 meters',
    icon: '⛰️',
    rarity: 'common',
    requirementType: 'elevation',
    requirementValue: 1000,
  },
  {
    id: 'mountain-goat',
    name: 'Mountain Goat',
    description: 'Climb a total of 10,000 meters',
    icon: '🏔️',
    rarity: 'rare',
    requirementType: 'elevation',
    requirementValue: 10000,
  },
  {
    id: 'everest-climber',
    name: 'Everest Climber',
    description: 'Climb a total of 8,849 meters (Mount Everest height)',
    icon: '🗻',
    rarity: 'epic',
    requirementType: 'elevation',
    requirementValue: 8849,
  },

  // Activity Count Achievements
  {
    id: 'getting-started',
    name: 'Getting Started',
    description: 'Complete 10 activities',
    icon: '✨',
    rarity: 'common',
    requirementType: 'activities',
    requirementValue: 10,
  },
  {
    id: 'dedicated-athlete',
    name: 'Dedicated Athlete',
    description: 'Complete 50 activities',
    icon: '💪',
    rarity: 'rare',
    requirementType: 'activities',
    requirementValue: 50,
  },
  {
    id: 'century-activities',
    name: 'Century of Activities',
    description: 'Complete 100 activities',
    icon: '🏆',
    rarity: 'epic',
    requirementType: 'activities',
    requirementValue: 100,
  },
  {
    id: 'unstoppable',
    name: 'Unstoppable',
    description: 'Complete 365 activities (one per day for a year)',
    icon: '⚡',
    rarity: 'legendary',
    requirementType: 'activities',
    requirementValue: 365,
  },

  // Streak Achievements
  {
    id: 'week-warrior',
    name: 'Week Warrior',
    description: 'Maintain a 7-day activity streak',
    icon: '📅',
    rarity: 'common',
    requirementType: 'streak',
    requirementValue: 7,
  },
  {
    id: 'month-master',
    name: 'Month Master',
    description: 'Maintain a 30-day activity streak',
    icon: '🗓️',
    rarity: 'rare',
    requirementType: 'streak',
    requirementValue: 30,
  },
  {
    id: 'year-legend',
    name: 'Year Legend',
    description: 'Maintain a 365-day activity streak',
    icon: '📆',
    rarity: 'legendary',
    requirementType: 'streak',
    requirementValue: 365,
  },

  // Activity Type Specific
  {
    id: 'runner-rookie',
    name: 'Runner Rookie',
    description: 'Complete 10 runs',
    icon: '👟',
    rarity: 'common',
    requirementType: 'activities',
    requirementValue: 10,
    activityType: 'Run',
  },

  // Secret Achievements - Hidden until unlocked
  {
    id: 'secret-lucky-13',
    name: 'Lucky 13',
    description: 'Complete exactly 13 activities',
    icon: '🍀',
    rarity: 'rare',
    requirementType: 'activities',
    requirementValue: 13,
    isSecret: true,
  },
  {
    id: 'secret-meaning-of-life',
    name: 'The Answer',
    description: 'Complete 42 activities (the meaning of life, the universe, and everything)',
    icon: '🤖',
    rarity: 'epic',
    requirementType: 'activities',
    requirementValue: 42,
    isSecret: true,
  },
  {
    id: 'secret-nice',
    name: 'Nice',
    description: 'Complete 69 activities... nice',
    icon: '😏',
    rarity: 'epic',
    requirementType: 'activities',
    requirementValue: 69,
    isSecret: true,
  },
  {
    id: 'secret-elevation-beast',
    name: 'Elevation Beast',
    description: 'Climb exactly 6,666 meters',
    icon: '😈',
    rarity: 'epic',
    requirementType: 'elevation',
    requirementValue: 6666,
    isSecret: true,
  },
  {
    id: 'secret-marathon-distance',
    name: 'Marathon Ghost',
    description: 'Cover exactly 42.195 kilometers in total',
    icon: '👻',
    rarity: 'rare',
    requirementType: 'distance',
    requirementValue: 42195, // meters
    isSecret: true,
  },
];

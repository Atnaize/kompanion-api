/**
 * Database Seeder
 *
 * Idempotent seeding - can be run multiple times safely
 * - Adds new achievements/quests if they don't exist
 * - Updates existing ones if changed
 * - Removes achievements/quests that are no longer defined
 *
 * Run with: npm run db:seed
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ACHIEVEMENTS } from '../src/shared/data/achievements.data.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Starting database seed...\n');

  try {
    await seedAchievements();

    console.log('\n✅ Seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  }
}

/**
 * Seed achievements - idempotent
 * Creates new, updates existing, removes old
 */
async function seedAchievements(): Promise<void> {
  console.log('📊 Seeding achievements...');

  const definedIds = ACHIEVEMENTS.map((a) => a.id);

  // Get existing achievements
  const existing = await prisma.achievement.findMany();
  const existingIds = existing.map((a) => a.id);

  // Find achievements to remove (in DB but not in code)
  const toRemove = existingIds.filter((id) => !definedIds.includes(id));

  // Remove obsolete achievements (and their related records)
  if (toRemove.length > 0) {
    console.log(`   🗑️  Removing ${toRemove.length} obsolete achievements: ${toRemove.join(', ')}`);

    // First delete related records (foreign key constraints)
    await prisma.achievementProgress.deleteMany({
      where: { achievementId: { in: toRemove } },
    });
    await prisma.userAchievement.deleteMany({
      where: { achievementId: { in: toRemove } },
    });

    // Now delete the achievements
    await prisma.achievement.deleteMany({
      where: { id: { in: toRemove } },
    });
  }

  // Upsert all defined achievements
  let added = 0;
  let updated = 0;

  for (const achievement of ACHIEVEMENTS) {
    const isNew = !existingIds.includes(achievement.id);

    await prisma.achievement.upsert({
      where: { id: achievement.id },
      create: {
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        rarity: achievement.rarity,
        requirementType: achievement.requirementType,
        requirementValue: achievement.requirementValue,
        activityType: achievement.activityType,
        isSecret: achievement.isSecret || false,
      },
      update: {
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        rarity: achievement.rarity,
        requirementType: achievement.requirementType,
        requirementValue: achievement.requirementValue,
        activityType: achievement.activityType,
        isSecret: achievement.isSecret || false,
      },
    });

    if (isNew) {
      added++;
    } else {
      updated++;
    }
  }

  console.log(
    `   ✅ Achievements: ${added} added, ${updated} updated, ${toRemove.length} removed`
  );
  console.log(`   📈 Total achievements: ${ACHIEVEMENTS.length}`);
}

// Execute seeder
main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

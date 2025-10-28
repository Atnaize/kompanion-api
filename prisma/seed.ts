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
import { QUEST_TEMPLATES } from '../src/shared/data/quests.data.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Starting database seed...\n');

  try {
    await seedAchievements();
    await seedQuestTemplates();

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

  // Remove obsolete achievements
  if (toRemove.length > 0) {
    console.log(`   🗑️  Removing ${toRemove.length} obsolete achievements: ${toRemove.join(', ')}`);
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

/**
 * Seed quest templates - idempotent
 * Creates new templates, updates existing, removes old
 */
async function seedQuestTemplates(): Promise<void> {
  console.log('\n🎯 Seeding quest templates...');

  const definedIds = QUEST_TEMPLATES.map((q) => q.id);

  // Get existing quests
  const existing = await prisma.quest.findMany({
    include: { objectives: true },
  });
  const existingIds = existing.map((q) => q.id);

  // Find quests to remove
  const toRemove = existingIds.filter((id) => !definedIds.includes(id));

  // Remove obsolete quests (this will cascade delete objectives and user_quests)
  if (toRemove.length > 0) {
    console.log(`   🗑️  Removing ${toRemove.length} obsolete quests: ${toRemove.join(', ')}`);
    await prisma.quest.deleteMany({
      where: { id: { in: toRemove } },
    });
  }

  // Upsert quest templates
  let added = 0;
  let updated = 0;

  for (const template of QUEST_TEMPLATES) {
    const isNew = !existingIds.includes(template.id);

    // Use transaction to ensure quest and objectives are created/updated together
    await prisma.$transaction(async (tx) => {
      // Upsert quest
      await tx.quest.upsert({
        where: { id: template.id },
        create: {
          id: template.id,
          name: template.name,
          description: template.description,
          type: template.type,
          startDate: new Date('2000-01-01'), // Template - not an actual instance
          endDate: new Date('2099-12-31'), // Template - not an actual instance
          rewardXp: template.rewardXp,
          rewardAchievements: template.rewardAchievements || null,
        },
        update: {
          name: template.name,
          description: template.description,
          type: template.type,
          rewardXp: template.rewardXp,
          rewardAchievements: template.rewardAchievements || null,
        },
      });

      // Delete old objectives
      await tx.questObjective.deleteMany({
        where: { questId: template.id },
      });

      // Create new objectives
      for (const objective of template.objectives) {
        await tx.questObjective.create({
          data: {
            id: objective.id,
            questId: template.id,
            description: objective.description,
            type: objective.type,
            target: objective.target,
            activityType: objective.activityType,
          },
        });
      }
    });

    if (isNew) {
      added++;
    } else {
      updated++;
    }
  }

  console.log(`   ✅ Quests: ${added} added, ${updated} updated, ${toRemove.length} removed`);
  console.log(`   📈 Total quest templates: ${QUEST_TEMPLATES.length}`);
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

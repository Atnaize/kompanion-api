-- Remove Quest System and XP/Level fields

-- Drop user_quests table (has foreign keys to quests and users)
DROP TABLE IF EXISTS "user_quests";

-- Drop quest_objectives table (has foreign key to quests)
DROP TABLE IF EXISTS "quest_objectives";

-- Drop quests table
DROP TABLE IF EXISTS "quests";

-- Remove level and xp columns from user_stats
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "level";
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "xp";

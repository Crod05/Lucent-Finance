import { eq, and } from "drizzle-orm";
import { db, userProgressTable, earnedAchievementsTable } from "@workspace/db";

const DEFAULT_USER = "default-user";

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 4000];

export function computeLevel(totalXp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (totalXp >= LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

export function computeXpToNextLevel(totalXp: number): number {
  const level = computeLevel(totalXp);
  if (level >= LEVEL_THRESHOLDS.length) return 0;
  return LEVEL_THRESHOLDS[level] - totalXp;
}

export function computeLevelProgress(totalXp: number): number {
  const level = computeLevel(totalXp);
  const currentThreshold = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const nextThreshold = LEVEL_THRESHOLDS[level];
  if (!nextThreshold) return 100;
  return Math.round(((totalXp - currentThreshold) / (nextThreshold - currentThreshold)) * 100);
}

export async function getOrCreateProgress() {
  const [existing] = await db
    .select()
    .from(userProgressTable)
    .where(eq(userProgressTable.userId, DEFAULT_USER));

  if (existing) return existing;

  const [created] = await db
    .insert(userProgressTable)
    .values({ userId: DEFAULT_USER })
    .returning();
  return created;
}

export async function awardXp(amount: number): Promise<{ xpAwarded: number; newTotalXp: number; newLevel: number; leveledUp: boolean }> {
  const progress = await getOrCreateProgress();
  const oldLevel = computeLevel(progress.totalXp);
  const newTotalXp = progress.totalXp + amount;
  const newLevel = computeLevel(newTotalXp);

  await db
    .update(userProgressTable)
    .set({ totalXp: newTotalXp, level: newLevel })
    .where(eq(userProgressTable.userId, DEFAULT_USER));

  return { xpAwarded: amount, newTotalXp, newLevel, leveledUp: newLevel > oldLevel };
}

export async function grantAchievementIfNew(
  badgeKey: string,
  name: string,
  description: string
): Promise<boolean> {
  const [existing] = await db
    .select()
    .from(earnedAchievementsTable)
    .where(
      and(
        eq(earnedAchievementsTable.userId, DEFAULT_USER),
        eq(earnedAchievementsTable.badgeKey, badgeKey)
      )
    );
  if (existing) return false;

  await db.insert(earnedAchievementsTable).values({
    userId: DEFAULT_USER,
    badgeKey,
    name,
    description,
  });
  return true;
}

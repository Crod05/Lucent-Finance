import { eq, and } from "drizzle-orm";
import {
  db,
  userProgressTable,
  earnedAchievementsTable,
  xpEventsTable,
  dailyMissionsTable,
} from "@workspace/db";

const DEFAULT_USER = "default-user";

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000, 2000, 4000];

/**
 * The Financial Class evolution ladder. Classes are ordered; each has an XP
 * threshold. The class is "hybrid": the player chooses a starting class at
 * onboarding (which acts as a floor and sets initial tone), and evolves UP the
 * ladder as XP thresholds are reached — never regressing below the chosen start.
 */
export const CLASS_LADDER = [
  { key: "Survivor", threshold: 0 },
  { key: "Builder", threshold: 250 },
  { key: "Investor", threshold: 500 },
  { key: "Strategist", threshold: 1000 },
  { key: "Owner", threshold: 2000 },
  { key: "Legacy Builder", threshold: 4000 },
] as const;

function classIndex(key: string | null | undefined): number {
  const idx = CLASS_LADDER.findIndex((c) => c.key === key);
  return idx < 0 ? 0 : idx;
}

export interface ClassEvolution {
  currentClass: string;
  nextClass: string | null;
  classProgress: number;
  xpToNextClass: number;
}

/**
 * Computes the player's current class given their total XP and their chosen
 * starting class. The current class is the higher of (a) the XP-earned class
 * and (b) the chosen starting class — so choosing a class never demotes you,
 * but XP can promote you above it.
 */
export function computeClassEvolution(
  totalXp: number,
  startingClass: string | null | undefined
): ClassEvolution {
  let xpIndex = 0;
  for (let i = 0; i < CLASS_LADDER.length; i++) {
    if (totalXp >= CLASS_LADDER[i].threshold) xpIndex = i;
    else break;
  }
  const currentIndex = Math.max(xpIndex, classIndex(startingClass));
  const current = CLASS_LADDER[currentIndex];
  const next = CLASS_LADDER[currentIndex + 1] ?? null;

  if (!next) {
    return { currentClass: current.key, nextClass: null, classProgress: 100, xpToNextClass: 0 };
  }

  const span = next.threshold - current.threshold;
  const gained = Math.max(0, totalXp - current.threshold);
  const classProgress = span > 0 ? Math.min(100, Math.round((gained / span) * 100)) : 0;
  const xpToNextClass = Math.max(0, next.threshold - totalXp);
  return { currentClass: current.key, nextClass: next.key, classProgress, xpToNextClass };
}

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

  await db.insert(userProgressTable).values({ userId: DEFAULT_USER }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(userProgressTable)
    .where(eq(userProgressTable.userId, DEFAULT_USER));
  return row;
}

export interface XpAwardResult {
  xpAwarded: number;
  newTotalXp: number;
  newLevel: number;
  leveledUp: boolean;
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function awardXpForEventInTx(
  tx: DbTx,
  eventType: string,
  sourceId: string,
  amount: number
): Promise<XpAwardResult> {
  await tx.insert(userProgressTable).values({ userId: DEFAULT_USER }).onConflictDoNothing();

  const [progress] = await tx
    .select()
    .from(userProgressTable)
    .where(eq(userProgressTable.userId, DEFAULT_USER))
    .for("update");

  const inserted = await tx
    .insert(xpEventsTable)
    .values({ userId: DEFAULT_USER, eventType, sourceId, xpAmount: amount })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    // Event already recorded — do not double-award.
    return {
      xpAwarded: 0,
      newTotalXp: progress.totalXp,
      newLevel: computeLevel(progress.totalXp),
      leveledUp: false,
    };
  }

  const oldLevel = computeLevel(progress.totalXp);
  const newTotalXp = progress.totalXp + amount;
  const newLevel = computeLevel(newTotalXp);

  await tx
    .update(userProgressTable)
    .set({ totalXp: newTotalXp, level: newLevel })
    .where(eq(userProgressTable.userId, DEFAULT_USER));

  return { xpAwarded: amount, newTotalXp, newLevel, leveledUp: newLevel > oldLevel };
}

/**
 * Awards XP atomically and idempotently. The (userId, eventType, sourceId)
 * tuple is unique in xp_events; if the event already exists, no XP is awarded.
 * The event insert and progress update happen in the same DB transaction,
 * with the progress row locked to prevent concurrent lost updates.
 */
export async function awardXpForEvent(
  eventType: string,
  sourceId: string,
  amount: number
): Promise<XpAwardResult> {
  return await db.transaction(async (tx) => awardXpForEventInTx(tx, eventType, sourceId, amount));
}

async function grantAchievementIfNewInTx(
  tx: DbTx,
  badgeKey: string,
  name: string,
  description: string
): Promise<boolean> {
  const inserted = await tx
    .insert(earnedAchievementsTable)
    .values({ userId: DEFAULT_USER, badgeKey, name, description })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}

export async function grantAchievementIfNew(
  badgeKey: string,
  name: string,
  description: string
): Promise<boolean> {
  const inserted = await db
    .insert(earnedAchievementsTable)
    .values({ userId: DEFAULT_USER, badgeKey, name, description })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}

/**
 * Completes today's mission if (and only if) it matches the given missionType
 * and is still pending. Called from the action routes themselves (adding a
 * transaction, paying a bill, viewing insights, reviewing budgets) so missions
 * cannot be completed without performing the real action.
 *
 * The status flip uses a conditional UPDATE (status = 'pending') as an atomic
 * claim, so concurrent requests can't complete the same mission twice; XP is
 * awarded idempotently via xp_events keyed on the mission id.
 *
 * The claim, XP award, streak update, and achievement grants all run in one
 * DB transaction, so a failure at any step rolls back the claim and the
 * mission stays pending — no XP or streak progress can be lost.
 */
export async function completeMissionIfPending(missionType: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(dailyMissionsTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(
          eq(dailyMissionsTable.userId, DEFAULT_USER),
          eq(dailyMissionsTable.date, today),
          eq(dailyMissionsTable.missionType, missionType),
          eq(dailyMissionsTable.status, "pending")
        )
      )
      .returning();

    if (claimed.length === 0) return;
    const mission = claimed[0];

    // Locks the user_progress row for the rest of this transaction.
    await awardXpForEventInTx(tx, "mission_completed", String(mission.id), mission.xpReward);

    // Update streak (once per day; the atomic claim above guarantees this
    // branch runs at most once per mission/day).
    const [progress] = await tx
      .select()
      .from(userProgressTable)
      .where(eq(userProgressTable.userId, DEFAULT_USER));

    if (progress.lastMissionDate !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const newStreak = progress.lastMissionDate === yesterdayStr ? progress.currentStreak + 1 : 1;
      const newLongest = Math.max(newStreak, progress.longestStreak);

      await tx
        .update(userProgressTable)
        .set({ currentStreak: newStreak, longestStreak: newLongest, lastMissionDate: today })
        .where(eq(userProgressTable.userId, DEFAULT_USER));

      if (newStreak >= 3) {
        await grantAchievementIfNewInTx(
          tx,
          "streak_3",
          "3-Day Streak",
          "Completed daily missions 3 days in a row"
        );
      }
    }

    if (mission.missionType === "check_insights") {
      await grantAchievementIfNewInTx(
        tx,
        "insight_seeker",
        "Insight Seeker",
        "Completed the Explore Insights daily mission"
      );
    }
  });
}

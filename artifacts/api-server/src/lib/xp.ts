import { eq, and, gte, lte } from "drizzle-orm";
import {
  db,
  userProgressTable,
  earnedAchievementsTable,
  xpEventsTable,
  dailyMissionsTable,
  bonusMissionsTable,
} from "@workspace/db";

const DEFAULT_USER = "default-user";

// ---------------------------------------------------------------------------
// Dates. All gamification dates use UTC calendar dates (YYYY-MM-DD), matching
// how transaction/mission dates are stored. Single-user app: there is no
// per-player timezone yet; when real accounts land, these helpers are the one
// place to thread a player timezone through.
// ---------------------------------------------------------------------------

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Monday-based start of the calendar week containing the given UTC date. */
export function weekStartStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

/** Sunday end of the calendar week containing the given UTC date. */
export function weekEndStr(dateStr: string): string {
  const d = new Date(`${weekStartStr(dateStr)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Deterministic daily mission assignment. The day's primary mission is a pure
// function of the date, so GET routes can display it without writing anything;
// the daily_missions row is only materialized when a real action completes it.
// ---------------------------------------------------------------------------

export const MISSION_POOL = [
  {
    missionType: "log_transaction",
    title: "Log a Transaction",
    description: "Record one income or expense today to keep your finances current.",
    xpReward: 25,
  },
  {
    missionType: "review_budget",
    title: "Review Your Budget",
    description: "Visit your budgets page and review how you're tracking this month.",
    xpReward: 25,
  },
  {
    missionType: "pay_bill",
    title: "Pay a Bill",
    description: "Mark at least one upcoming bill as paid today.",
    xpReward: 25,
  },
  {
    missionType: "check_insights",
    title: "Explore Your Insights",
    description: "Head to the Insights page and check your spending breakdown.",
    xpReward: 25,
  },
] as const;

export type MissionTemplate = (typeof MISSION_POOL)[number];

export function missionForDate(dateStr: string): MissionTemplate {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((d.getTime() - startOfYear) / 86400000);
  return MISSION_POOL[dayOfYear % MISSION_POOL.length];
}

export const BONUS_XP = 15;
export const WEEKLY_TARGET = 5;
export const WEEKLY_XP = 50;

/**
 * The day's bonus mission type: the first real-evidence-backed action type
 * that differs from the primary mission. Deterministic per date, so the
 * assignment is stable without needing a pre-created row.
 */
export function bonusMissionTypeForDate(dateStr: string): string | null {
  const primary = missionForDate(dateStr).missionType;
  return ["log_transaction", "pay_bill"].find((t) => t !== primary) ?? null;
}

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

/**
 * Read-only view of the user's progress. If no row exists yet, returns an
 * in-memory default projection WITHOUT writing anything — GET routes must use
 * this so reads stay side-effect free. The row is only materialized by write
 * paths (XP awards, onboarding) via getOrCreateProgress / awardXpForEventInTx.
 */
export async function readProgress(): Promise<typeof userProgressTable.$inferSelect> {
  const [existing] = await db
    .select()
    .from(userProgressTable)
    .where(eq(userProgressTable.userId, DEFAULT_USER));

  if (existing) return existing;

  const now = new Date();
  return {
    id: 0,
    userId: DEFAULT_USER,
    totalXp: 0,
    level: 1,
    currentStreak: 0,
    longestStreak: 0,
    lastMissionDate: null,
    name: null,
    spawnPoint: null,
    financialClass: null,
    primaryFinancialConcern: null,
    onboardingCompleted: false,
    createdAt: now,
    updatedAt: now,
  };
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

export interface MissionCompletionResult {
  missionCompleted: boolean;
  xpAwarded: number;
}

/**
 * Completes today's mission if (and only if) it matches the given missionType
 * and is still pending. Called ONLY from POST/PATCH action routes (adding a
 * transaction, paying a bill, the explicit reviewed/viewed intent endpoints)
 * so missions cannot be completed without performing the real action, and GET
 * routes stay side-effect free.
 *
 * Because GETs never create rows anymore, this first materializes today's
 * deterministic mission row (insert ... on conflict do nothing), then flips it
 * with a conditional UPDATE (status = 'pending') as an atomic claim, so
 * concurrent requests can't complete the same mission twice; XP is awarded
 * idempotently via xp_events keyed on the mission id.
 *
 * When the completion brings this calendar week (Mon–Sun, UTC) to the weekly
 * challenge target, the +50 XP weekly bonus is awarded exactly once in the
 * same transaction, keyed on (weekly_challenge, weekStartDate) in xp_events.
 *
 * The claim, XP awards, streak update, and achievement grants all run in one
 * DB transaction, so a failure at any step rolls back the claim and the
 * mission stays pending — no XP or streak progress can be lost.
 */
export async function completeMissionIfPending(missionType: string): Promise<MissionCompletionResult> {
  const today = todayStr();
  const template = missionForDate(today);

  return await db.transaction(async (tx) => {
    // Materialize today's deterministic mission row if it doesn't exist yet.
    await tx
      .insert(dailyMissionsTable)
      .values({
        userId: DEFAULT_USER,
        date: today,
        missionType: template.missionType,
        title: template.title,
        description: template.description,
        xpReward: template.xpReward,
        status: "pending",
      })
      .onConflictDoNothing();

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

    if (claimed.length === 0) return { missionCompleted: false, xpAwarded: 0 };
    const mission = claimed[0];

    // Locks the user_progress row for the rest of this transaction.
    const missionAward = await awardXpForEventInTx(
      tx,
      "mission_completed",
      String(mission.id),
      mission.xpReward
    );

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

    // Weekly challenge: if this completion brings the calendar week (Mon–Sun)
    // to the target, award the weekly bonus exactly once. Idempotency comes
    // from the xp_events unique key (userId, "weekly_challenge", weekStart) —
    // repeated completions or refreshes can never award it twice.
    const weekStart = weekStartStr(today);
    const weekEnd = weekEndStr(today);
    const completedThisWeek = await tx
      .select({ id: dailyMissionsTable.id })
      .from(dailyMissionsTable)
      .where(
        and(
          eq(dailyMissionsTable.userId, DEFAULT_USER),
          gte(dailyMissionsTable.date, weekStart),
          lte(dailyMissionsTable.date, weekEnd),
          eq(dailyMissionsTable.status, "completed")
        )
      );

    let weeklyXp = 0;
    if (completedThisWeek.length >= WEEKLY_TARGET) {
      const weeklyAward = await awardXpForEventInTx(tx, "weekly_challenge", weekStart, WEEKLY_XP);
      weeklyXp = weeklyAward.xpAwarded;
    }

    return { missionCompleted: true, xpAwarded: missionAward.xpAwarded + weeklyXp };
  });
}

/**
 * Persists and rewards the day's bonus mission when (and only when) the
 * specifically assigned underlying action occurs. The bonus_missions row
 * records slot, type, reward, status, completion timestamp, and the evidence
 * reference; unique(userId, date) makes the row write idempotent, and the
 * bonus XP is a separate xp_events entry keyed
 * (userId, "bonus_mission", `{date}:{type}`) so it can never double-award —
 * repeating the same action or refreshing changes nothing.
 */
export async function completeBonusIfAssigned(
  actionType: string,
  evidenceRef: string
): Promise<XpAwardResult | null> {
  const today = todayStr();
  if (bonusMissionTypeForDate(today) !== actionType) return null;

  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(bonusMissionsTable)
      .values({
        userId: DEFAULT_USER,
        date: today,
        slot: "bonus",
        missionType: actionType,
        xpReward: BONUS_XP,
        status: "completed",
        completedAt: new Date(),
        evidenceRef,
      })
      .onConflictDoNothing()
      .returning();

    // Already completed today — never re-award.
    if (inserted.length === 0) return null;

    return await awardXpForEventInTx(tx, "bonus_mission", `${today}:${actionType}`, BONUS_XP);
  });
}

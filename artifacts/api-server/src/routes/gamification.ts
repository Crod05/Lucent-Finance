import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  db,
  userProgressTable,
  dailyMissionsTable,
  bonusMissionsTable,
  earnedAchievementsTable,
  budgetsTable,
  billsTable,
  transactionsTable,
  xpEventsTable,
} from "@workspace/db";
import {
  GetProgressResponse,
  GetTodayMissionResponse,
  ListAchievementsResponse,
  GetScorecardResponse,
  GetBriefingResponse,
  CompleteOnboardingBody,
  CompleteOnboardingResponse,
  ResetOnboardingResponse,
} from "@workspace/api-zod";
import {
  getOrCreateProgress,
  readProgress,
  computeLevel,
  computeXpToNextLevel,
  computeLevelProgress,
  computeClassEvolution,
  todayStr,
  weekStartStr,
  weekEndStr,
  missionForDate,
  bonusMissionTypeForDate,
  MISSION_POOL,
  BONUS_XP,
  WEEKLY_TARGET,
  WEEKLY_XP,
} from "../lib/xp";

const router: IRouter = Router();

const DEFAULT_USER = "default-user";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Estimated time-to-complete per mission type, shown in the briefing so a
// player knows a mission is a quick micro-win.
const EST_SECONDS: Record<string, number> = {
  log_transaction: 30,
  review_budget: 20,
  pay_bill: 25,
  check_insights: 20,
};

// Positive, no-shame framing tied to the player's onboarding concern.
const CONCERN_NOTES: Record<string, string> = {
  Debt: "Every small action chips away at the mountain. You're moving forward.",
  "Living paycheck to paycheck": "Awareness is the first win. Each logged day builds your cushion.",
  "Not saving enough": "Small, steady wins compound. You're building the habit that builds savings.",
  "Not investing": "Clarity comes first, then confidence to invest. You're laying the groundwork.",
  "Supporting family": "Looking after your money is looking after them too. Nicely done.",
  "Buying a home": "Every organized day brings the keys a little closer.",
  Retirement: "Future you is grateful for the habits you're building today.",
  "Feeling disorganized": "One tidy action at a time — you're bringing order to the chaos.",
  "I'm not sure yet": "Exploring is progress. Keep showing up and the picture gets clearer.",
};

const ALL_ACHIEVEMENTS = [
  {
    badgeKey: "first_transaction",
    name: "First Transaction",
    description: "Logged your very first transaction",
    icon: "Zap",
  },
  {
    badgeKey: "streak_3",
    name: "3-Day Streak",
    description: "Completed daily missions 3 days in a row",
    icon: "Flame",
  },
  {
    badgeKey: "budget_guardian",
    name: "Budget Guardian",
    description: "Kept all budgets under their monthly limit",
    icon: "Shield",
  },
  {
    badgeKey: "bill_slayer",
    name: "Bill Slayer",
    description: "Marked your first bill as paid",
    icon: "Trophy",
  },
  {
    badgeKey: "insight_seeker",
    name: "Insight Seeker",
    description: "Completed the Explore Insights daily mission",
    icon: "Eye",
  },
];

function serializeProgress(progress: typeof userProgressTable.$inferSelect) {
  const evolution = computeClassEvolution(progress.totalXp, progress.financialClass);
  return GetProgressResponse.parse({
    userId: progress.userId,
    totalXp: progress.totalXp,
    level: computeLevel(progress.totalXp),
    currentStreak: progress.currentStreak,
    longestStreak: progress.longestStreak,
    lastMissionDate: progress.lastMissionDate ?? null,
    xpToNextLevel: computeXpToNextLevel(progress.totalXp),
    levelProgress: computeLevelProgress(progress.totalXp),
    name: progress.name ?? null,
    spawnPoint: progress.spawnPoint ?? null,
    financialClass: progress.financialClass ?? null,
    primaryFinancialConcern: progress.primaryFinancialConcern ?? null,
    onboardingCompleted: progress.onboardingCompleted,
    currentClass: evolution.currentClass,
    nextClass: evolution.nextClass,
    classProgress: evolution.classProgress,
    xpToNextClass: evolution.xpToNextClass,
  });
}

/**
 * Read-only view of today's primary mission. The assignment is a pure
 * function of the date; the daily_missions row is only materialized when a
 * real action completes it (see completeMissionIfPending), so this never
 * writes anything — GETs are side-effect free.
 */
async function readTodayMission() {
  const today = todayStr();

  const [existing] = await db
    .select()
    .from(dailyMissionsTable)
    .where(
      and(
        eq(dailyMissionsTable.userId, DEFAULT_USER),
        eq(dailyMissionsTable.date, today)
      )
    );

  if (existing) return existing;

  const template = missionForDate(today);
  return {
    id: null as number | null,
    userId: DEFAULT_USER,
    date: today,
    missionType: template.missionType,
    title: template.title,
    description: template.description,
    xpReward: template.xpReward,
    status: "pending" as string,
    completedAt: null as Date | null,
  };
}

router.get("/gamification/progress", async (req, res): Promise<void> => {
  const progress = await readProgress();
  res.json(serializeProgress(progress));
});

router.get("/gamification/missions/today", async (req, res): Promise<void> => {
  const row = await readTodayMission();
  res.json(
    GetTodayMissionResponse.parse({
      ...row,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    })
  );
});

router.get("/gamification/achievements", async (req, res): Promise<void> => {
  const earned = await db
    .select()
    .from(earnedAchievementsTable)
    .where(eq(earnedAchievementsTable.userId, DEFAULT_USER));

  const earnedKeys = new Set(earned.map((a) => a.badgeKey));
  const earnedMap = new Map(earned.map((a) => [a.badgeKey, a.earnedAt.toISOString()]));

  const result = ALL_ACHIEVEMENTS.map((a) => ({
    badgeKey: a.badgeKey,
    name: a.name,
    description: a.description,
    icon: a.icon,
    earned: earnedKeys.has(a.badgeKey),
    earnedAt: earnedMap.get(a.badgeKey) ?? null,
  }));

  res.json(ListAchievementsResponse.parse(result));
});

router.get("/gamification/scorecard", async (req, res): Promise<void> => {
  const now = new Date();

  const [budgets, bills, progress] = await Promise.all([
    db.select().from(budgetsTable).where(
      and(
        eq(budgetsTable.month, now.getMonth() + 1),
        eq(budgetsTable.year, now.getFullYear())
      )
    ),
    db.select().from(billsTable),
    readProgress(),
  ]);

  // Budget Health: % of budgets under their limit
  const budgetsUnder = budgets.filter((b) => Number(b.currentSpent) <= Number(b.monthlyLimit));
  const budgetScore = budgets.length > 0 ? Math.round((budgetsUnder.length / budgets.length) * 100) : 100;
  const budgetStatus = budgetScore >= 80 ? "good" : budgetScore >= 50 ? "warning" : "danger";

  // Bills Status: % of bills not overdue
  const today = now.toISOString().slice(0, 10);
  const overdueBills = bills.filter((b) => b.status === "overdue" || (b.status === "unpaid" && b.dueDate < today));
  const billScore = bills.length > 0 ? Math.round(((bills.length - overdueBills.length) / bills.length) * 100) : 100;
  const billStatus = billScore >= 90 ? "good" : billScore >= 60 ? "warning" : "danger";

  // Spending Awareness: based on level (proxy for engagement)
  const awarenessScore = Math.min(progress.level * 20, 100);
  const awarenessStatus = awarenessScore >= 60 ? "good" : awarenessScore >= 40 ? "warning" : "danger";

  // Habit Streak: streak out of 7 days goal
  const streakScore = Math.min(progress.currentStreak * 14, 100);
  const streakStatus = progress.currentStreak >= 3 ? "good" : progress.currentStreak >= 1 ? "warning" : "danger";

  res.json(
    GetScorecardResponse.parse({
      budgetHealth: { label: "Budget Health", score: budgetScore, maxScore: 100, status: budgetStatus },
      billsStatus: { label: "Bills Status", score: billScore, maxScore: 100, status: billStatus },
      spendingAwareness: { label: "Spending Awareness", score: awarenessScore, maxScore: 100, status: awarenessStatus },
      habitStreak: { label: "Habit Streak", score: streakScore, maxScore: 100, status: streakStatus },
    })
  );
});

function timeOfDay(): "morning" | "afternoon" | "evening" {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/**
 * Read-only view of the day's bonus mission. Assignment is deterministic
 * (bonusMissionTypeForDate); completion state comes from the persisted
 * bonus_missions row written by the action routes — nothing is created here.
 */
async function readBonusMission(today: string) {
  const type = bonusMissionTypeForDate(today);
  if (!type) return null;

  const pool = MISSION_POOL.find((m) => m.missionType === type);
  if (!pool) return null;

  const [row] = await db
    .select()
    .from(bonusMissionsTable)
    .where(
      and(
        eq(bonusMissionsTable.userId, DEFAULT_USER),
        eq(bonusMissionsTable.date, today)
      )
    );

  return {
    missionType: pool.missionType,
    title: pool.title,
    description: pool.description,
    xpReward: BONUS_XP,
    estimatedSeconds: EST_SECONDS[pool.missionType] ?? 30,
    status: row?.status === "completed" ? ("completed" as const) : ("pending" as const),
  };
}

async function buildTodaysInsight() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const txns = await db
    .select()
    .from(transactionsTable)
    .where(gte(transactionsTable.date, firstOfMonth));

  const expenses = txns.filter((t) => t.type === "expense");
  if (expenses.length === 0) {
    return {
      title: "Today's Insight",
      message: "No spending logged yet this month — a clean slate. Log a transaction to start your picture.",
    };
  }

  const byCategory = new Map<string, number>();
  for (const t of expenses) {
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + Number(t.amount));
  }
  const [topCategory, topAmount] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
  const formatted = `$${topAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  return {
    title: "Today's Insight",
    message: `Your biggest category this month is ${topCategory} at ${formatted}. Knowing where it goes is half the battle — nice awareness.`,
  };
}

router.get("/gamification/briefing", async (req, res): Promise<void> => {
  const today = todayStr();
  const [progress, missionRow] = await Promise.all([
    readProgress(),
    readTodayMission(),
  ]);

  const primaryMission = {
    missionType: missionRow.missionType,
    title: missionRow.title,
    description: missionRow.description,
    xpReward: missionRow.xpReward,
    estimatedSeconds: EST_SECONDS[missionRow.missionType] ?? 30,
    status: missionRow.status === "completed" ? ("completed" as const) : ("pending" as const),
  };

  const bonusMission = await readBonusMission(today);

  // Weekly Challenge: primary daily missions completed during the current
  // calendar week (Monday–Sunday, UTC dates). Completion state is persisted
  // as the (weekly_challenge, weekStart) xp_events row — awarded by the
  // action paths, never here.
  const weekStart = weekStartStr(today);
  const weekEnd = weekEndStr(today);
  const [weekMissions, weeklyAwardRows] = await Promise.all([
    db
      .select({ status: dailyMissionsTable.status })
      .from(dailyMissionsTable)
      .where(
        and(
          eq(dailyMissionsTable.userId, DEFAULT_USER),
          gte(dailyMissionsTable.date, weekStart),
          lte(dailyMissionsTable.date, weekEnd)
        )
      ),
    db
      .select({ id: xpEventsTable.id })
      .from(xpEventsTable)
      .where(
        and(
          eq(xpEventsTable.userId, DEFAULT_USER),
          eq(xpEventsTable.eventType, "weekly_challenge"),
          eq(xpEventsTable.sourceId, weekStart)
        )
      )
      .limit(1),
  ]);
  const completedThisWeek = weekMissions.filter((m) => m.status === "completed").length;

  const todaysInsight = await buildTodaysInsight();

  res.json(
    GetBriefingResponse.parse({
      timeOfDay: timeOfDay(),
      name: progress.name ?? null,
      personalizedNote: progress.primaryFinancialConcern
        ? CONCERN_NOTES[progress.primaryFinancialConcern] ?? null
        : null,
      primaryMission,
      bonusMission,
      weeklyChallenge: {
        title: "Weekly Streak Builder",
        description: `Complete ${WEEKLY_TARGET} daily missions this calendar week (Mon–Sun) to prove the habit is sticking.`,
        current: Math.min(completedThisWeek, WEEKLY_TARGET),
        target: WEEKLY_TARGET,
        xpReward: WEEKLY_XP,
        weekStart,
        completed: weeklyAwardRows.length > 0,
      },
      todaysInsight,
    })
  );
});

router.post("/gamification/onboarding", async (req, res): Promise<void> => {
  // Harden input: trim the name server-side, then validate with a strict
  // schema — unknown fields and invalid enum values are rejected with 400.
  const rawBody: Record<string, unknown> =
    req.body && typeof req.body === "object" ? { ...req.body } : {};
  if (typeof rawBody.name === "string") rawBody.name = rawBody.name.trim();

  const parsed = CompleteOnboardingBody.strict().safeParse(rawBody);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await getOrCreateProgress();

  // Completed onboarding is immutable: the conditional UPDATE only matches
  // when onboarding_completed is still false, so concurrent or repeated
  // submissions can never overwrite the original character.
  const [updated] = await db
    .update(userProgressTable)
    .set({
      name: parsed.data.name,
      spawnPoint: parsed.data.spawnPoint,
      primaryFinancialConcern: parsed.data.primaryFinancialConcern,
      financialClass: parsed.data.financialClass,
      onboardingCompleted: true,
    })
    .where(
      and(
        eq(userProgressTable.userId, DEFAULT_USER),
        eq(userProgressTable.onboardingCompleted, false)
      )
    )
    .returning();

  if (!updated) {
    res.status(409).json({
      error:
        "Onboarding is already completed and cannot be changed. Character creation is a one-time event.",
    });
    return;
  }

  req.log.info({ userId: DEFAULT_USER }, "onboarding completed");
  res.json(CompleteOnboardingResponse.parse(serializeProgress(updated)));
});

// Development/demo-only escape hatch. In production the route is not
// registered at all — a catch-all below returns 403 so the contract is
// explicit rather than a generic 404.
if (!IS_PRODUCTION) {
  router.post("/gamification/onboarding/reset", async (req, res): Promise<void> => {
    await getOrCreateProgress();
    const [updated] = await db
      .update(userProgressTable)
      .set({
        onboardingCompleted: false,
        name: null,
        spawnPoint: null,
        financialClass: null,
        primaryFinancialConcern: null,
      })
      .where(eq(userProgressTable.userId, DEFAULT_USER))
      .returning();

    req.log.info({ userId: DEFAULT_USER }, "onboarding reset");
    res.json(ResetOnboardingResponse.parse(serializeProgress(updated)));
  });
} else {
  router.post("/gamification/onboarding/reset", (req, res): void => {
    res.status(403).json({ error: "Onboarding reset is not available in production." });
  });
}

export default router;

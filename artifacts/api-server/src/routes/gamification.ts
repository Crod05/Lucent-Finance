import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  db,
  userProgressTable,
  dailyMissionsTable,
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
  computeLevel,
  computeXpToNextLevel,
  computeLevelProgress,
  computeClassEvolution,
} from "../lib/xp";

const router: IRouter = Router();

const DEFAULT_USER = "default-user";

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

const MISSION_POOL = [
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
];

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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

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
 * Returns today's persisted daily mission, generating it deterministically
 * (by day-of-year) if it doesn't exist yet. This is the single source of
 * truth for the day's primary mission — the briefing reuses it unchanged.
 */
async function getOrCreateTodayMission() {
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

  const dayOfYear = Math.floor(
    (new Date().getTime() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  const mission = MISSION_POOL[dayOfYear % MISSION_POOL.length];

  // onConflictDoNothing + re-select handles concurrent requests racing to
  // create today's mission (unique constraint on userId + date).
  const [created] = await db
    .insert(dailyMissionsTable)
    .values({
      userId: DEFAULT_USER,
      date: today,
      missionType: mission.missionType,
      title: mission.title,
      description: mission.description,
      xpReward: mission.xpReward,
      status: "pending",
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [row] = await db
    .select()
    .from(dailyMissionsTable)
    .where(
      and(
        eq(dailyMissionsTable.userId, DEFAULT_USER),
        eq(dailyMissionsTable.date, today)
      )
    );
  return row;
}

router.get("/gamification/progress", async (req, res): Promise<void> => {
  const progress = await getOrCreateProgress();
  res.json(serializeProgress(progress));
});

router.get("/gamification/missions/today", async (req, res): Promise<void> => {
  const row = await getOrCreateTodayMission();
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
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [budgets, bills, progress] = await Promise.all([
    db.select().from(budgetsTable).where(
      and(
        eq(budgetsTable.month, now.getMonth() + 1),
        eq(budgetsTable.year, now.getFullYear())
      )
    ),
    db.select().from(billsTable),
    getOrCreateProgress(),
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
 * Builds the optional bonus mission: a second real-backed action, different
 * from the primary. Only mission types whose completion we can verify from
 * real data are eligible (P0 rule — no fake completion). Completion is derived
 * from evidence, never a button.
 */
async function buildBonusMission(primaryType: string, today: string) {
  // Detectable candidates, in priority order. Both map to real evidence.
  const candidates = ["log_transaction", "pay_bill"].filter((t) => t !== primaryType);
  const type = candidates[0];
  if (!type) return null;

  const pool = MISSION_POOL.find((m) => m.missionType === type);
  if (!pool) return null;

  let completed = false;
  if (type === "log_transaction") {
    const rows = await db
      .select({ id: transactionsTable.id })
      .from(transactionsTable)
      .where(eq(transactionsTable.date, today))
      .limit(1);
    completed = rows.length > 0;
  } else if (type === "pay_bill") {
    const rows = await db
      .select({ id: xpEventsTable.id })
      .from(xpEventsTable)
      .where(
        and(
          eq(xpEventsTable.userId, DEFAULT_USER),
          eq(xpEventsTable.eventType, "bill_paid"),
          gte(xpEventsTable.createdAt, new Date(`${today}T00:00:00.000Z`))
        )
      )
      .limit(1);
    completed = rows.length > 0;
  }

  return {
    missionType: pool.missionType,
    title: pool.title,
    description: pool.description,
    xpReward: 15,
    estimatedSeconds: EST_SECONDS[pool.missionType] ?? 30,
    status: completed ? ("completed" as const) : ("pending" as const),
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
    getOrCreateProgress(),
    getOrCreateTodayMission(),
  ]);

  const primaryMission = {
    missionType: missionRow.missionType,
    title: missionRow.title,
    description: missionRow.description,
    xpReward: missionRow.xpReward,
    estimatedSeconds: EST_SECONDS[missionRow.missionType] ?? 30,
    status: missionRow.status === "completed" ? ("completed" as const) : ("pending" as const),
  };

  const bonusMission = await buildBonusMission(missionRow.missionType, today);

  // Weekly Challenge: daily missions completed in the last 7 days (rolling).
  const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const weekMissions = await db
    .select({ status: dailyMissionsTable.status })
    .from(dailyMissionsTable)
    .where(
      and(
        eq(dailyMissionsTable.userId, DEFAULT_USER),
        gte(dailyMissionsTable.date, weekStart),
        lte(dailyMissionsTable.date, today)
      )
    );
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
        description: "Complete 5 daily missions this week to prove the habit is sticking.",
        current: Math.min(completedThisWeek, 5),
        target: 5,
        xpReward: 50,
      },
      todaysInsight,
    })
  );
});

router.post("/gamification/onboarding", async (req, res): Promise<void> => {
  const parsed = CompleteOnboardingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await getOrCreateProgress();
  const [updated] = await db
    .update(userProgressTable)
    .set({
      name: parsed.data.name,
      spawnPoint: parsed.data.spawnPoint,
      primaryFinancialConcern: parsed.data.primaryFinancialConcern,
      financialClass: parsed.data.financialClass,
      onboardingCompleted: true,
    })
    .where(eq(userProgressTable.userId, DEFAULT_USER))
    .returning();

  req.log.info({ userId: DEFAULT_USER }, "onboarding completed");
  res.json(CompleteOnboardingResponse.parse(serializeProgress(updated)));
});

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

export default router;

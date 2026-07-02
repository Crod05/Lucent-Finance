import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  userProgressTable,
  dailyMissionsTable,
  earnedAchievementsTable,
  budgetsTable,
  billsTable,
  transactionsTable,
} from "@workspace/db";
import {
  GetProgressResponse,
  GetTodayMissionResponse,
  ListAchievementsResponse,
  GetScorecardResponse,
} from "@workspace/api-zod";
import {
  getOrCreateProgress,
  computeLevel,
  computeXpToNextLevel,
  computeLevelProgress,
} from "../lib/xp";

const router: IRouter = Router();

const DEFAULT_USER = "default-user";

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

router.get("/gamification/progress", async (req, res): Promise<void> => {
  const progress = await getOrCreateProgress();
  res.json(
    GetProgressResponse.parse({
      userId: progress.userId,
      totalXp: progress.totalXp,
      level: computeLevel(progress.totalXp),
      currentStreak: progress.currentStreak,
      longestStreak: progress.longestStreak,
      lastMissionDate: progress.lastMissionDate ?? null,
      xpToNextLevel: computeXpToNextLevel(progress.totalXp),
      levelProgress: computeLevelProgress(progress.totalXp),
    })
  );
});

router.get("/gamification/missions/today", async (req, res): Promise<void> => {
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

  if (existing) {
    res.json(
      GetTodayMissionResponse.parse({
        ...existing,
        completedAt: existing.completedAt ? existing.completedAt.toISOString() : null,
      })
    );
    return;
  }

  // Pick a mission based on day-of-year so it rotates deterministically
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

  const row =
    created ??
    (
      await db
        .select()
        .from(dailyMissionsTable)
        .where(
          and(
            eq(dailyMissionsTable.userId, DEFAULT_USER),
            eq(dailyMissionsTable.date, today)
          )
        )
    )[0];

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

export default router;

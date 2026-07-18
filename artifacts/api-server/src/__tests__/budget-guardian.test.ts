import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  isMonthCompliant,
  previousCompletedMonth,
  isMonthCompleted,
} from "../lib/budget-guardian";

describe("isMonthCompliant (pure)", () => {
  it("is false with no budgets — no badge for having none", () => {
    expect(isMonthCompliant([])).toBe(false);
  });

  it("is true when every budget is at or below its limit", () => {
    expect(
      isMonthCompliant([
        { monthlyLimit: "500.00", currentSpent: "499.99" },
        { monthlyLimit: "100.00", currentSpent: "100.00" },
      ])
    ).toBe(true);
  });

  it("is false when any budget is over its limit", () => {
    expect(
      isMonthCompliant([
        { monthlyLimit: "500.00", currentSpent: "10.00" },
        { monthlyLimit: "100.00", currentSpent: "100.01" },
      ])
    ).toBe(false);
  });
});

describe("month helpers (pure, UTC)", () => {
  it("previousCompletedMonth handles mid-year and January rollover", () => {
    expect(previousCompletedMonth(new Date("2026-07-11T00:00:00Z"))).toEqual({
      year: 2026,
      month: 6,
    });
    expect(previousCompletedMonth(new Date("2026-01-05T00:00:00Z"))).toEqual({
      year: 2025,
      month: 12,
    });
  });

  it("isMonthCompleted only accepts fully elapsed months", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    expect(isMonthCompleted(2026, 6, now)).toBe(true);
    expect(isMonthCompleted(2026, 7, now)).toBe(false); // current month
    expect(isMonthCompleted(2026, 8, now)).toBe(false); // future month
    expect(isMonthCompleted(2025, 12, now)).toBe(true);
  });

  it("a month is not completed until its final UTC midnight has passed", () => {
    expect(isMonthCompleted(2026, 6, new Date("2026-06-30T23:59:59Z"))).toBe(false);
    expect(isMonthCompleted(2026, 6, new Date("2026-07-01T00:00:00Z"))).toBe(true);
  });
});

describe("evaluateBudgetGuardianForMonth (DB)", () => {
  const NOW = new Date("2026-07-11T12:00:00Z");
  let db: typeof import("@workspace/db").db;
  let budgetsTable: typeof import("@workspace/db").budgetsTable;
  let transactionsTable: typeof import("@workspace/db").transactionsTable;
  let earnedAchievementsTable: typeof import("@workspace/db").earnedAchievementsTable;
  let evaluateBudgetGuardianForMonth: typeof import("../lib/budget-guardian").evaluateBudgetGuardianForMonth;
  let evaluateBudgetGuardian: typeof import("../lib/budget-guardian").evaluateBudgetGuardian;

  beforeAll(async () => {
    ({ db, budgetsTable, transactionsTable, earnedAchievementsTable } = await import(
      "@workspace/db"
    ));
    ({ evaluateBudgetGuardianForMonth, evaluateBudgetGuardian } = await import(
      "../lib/budget-guardian"
    ));
  });

  const badgeCount = async () => {
    const rows = await db
      .select()
      .from(earnedAchievementsTable)
      .where(eq(earnedAchievementsTable.badgeKey, "budget_guardian"));
    return rows.length;
  };

  const clearMonth = async (year: number, month: number) => {
    await db
      .delete(budgetsTable)
      .where(and(eq(budgetsTable.year, year), eq(budgetsTable.month, month)));
  };

  beforeEach(async () => {
    await db
      .delete(earnedAchievementsTable)
      .where(eq(earnedAchievementsTable.badgeKey, "budget_guardian"));
    await clearMonth(2026, 5);
    await clearMonth(2026, 6);
    await clearMonth(2026, 7);
  });

  it("grants the badge once for a completed compliant month", async () => {
    await db.insert(budgetsTable).values([
      { category: "Food", monthlyLimit: "500.00", currentSpent: "300.00", month: 6, year: 2026 },
      { category: "Fun", monthlyLimit: "150.00", currentSpent: "150.00", month: 6, year: 2026 },
    ]);

    expect(await evaluateBudgetGuardianForMonth(2026, 6, NOW)).toBe(true);
    expect(await badgeCount()).toBe(1);
  });

  it("does not grant for an over-budget month (evaluator-derived spending)", async () => {
    await db.insert(budgetsTable).values([
      { category: "Food", monthlyLimit: "500.00", currentSpent: "300.00", month: 5, year: 2026 },
      { category: "GuardianFun", monthlyLimit: "150.00", currentSpent: "0.00", month: 5, year: 2026 },
    ]);
    // Real confirmed spending over the GuardianFun limit — compliance is now
    // judged on evaluator-derived spending, not the currentSpent aggregate.
    const [over] = await db
      .insert(transactionsTable)
      .values({
        date: "2026-05-15",
        description: "Guardian overspend May",
        amount: "150.01",
        category: "GuardianFun",
        type: "expense",
        classification: "expense",
        classificationStatus: "confirmed",
      })
      .returning();

    expect(await evaluateBudgetGuardianForMonth(2026, 5, NOW)).toBe(false);
    expect(await badgeCount()).toBe(0);

    await db.delete(transactionsTable).where(eq(transactionsTable.id, over.id));
  });

  it("repeated evaluation never duplicates the badge", async () => {
    await db
      .insert(budgetsTable)
      .values([
        { category: "Food", monthlyLimit: "500.00", currentSpent: "100.00", month: 6, year: 2026 },
      ]);

    expect(await evaluateBudgetGuardianForMonth(2026, 6, NOW)).toBe(true);
    expect(await evaluateBudgetGuardianForMonth(2026, 6, NOW)).toBe(false);
    expect(await evaluateBudgetGuardianForMonth(2026, 6, NOW)).toBe(false);
    expect(await badgeCount()).toBe(1);
  });

  it("never grants for the current (incomplete) month, even with compliant budgets", async () => {
    await db
      .insert(budgetsTable)
      .values([
        { category: "Food", monthlyLimit: "500.00", currentSpent: "0.00", month: 7, year: 2026 },
      ]);

    expect(await evaluateBudgetGuardianForMonth(2026, 7, NOW)).toBe(false);
    expect(await badgeCount()).toBe(0);
  });

  it("does not grant when the completed month had no budgets at all", async () => {
    expect(await evaluateBudgetGuardianForMonth(2026, 6, NOW)).toBe(false);
    expect(await badgeCount()).toBe(0);
  });

  it("evaluateBudgetGuardian targets the previous completed month", async () => {
    await db
      .insert(budgetsTable)
      .values([
        { category: "Food", monthlyLimit: "500.00", currentSpent: "10.00", month: 6, year: 2026 },
      ]);

    expect(await evaluateBudgetGuardian(NOW)).toBe(true);
    expect(await badgeCount()).toBe(1);
  });
});

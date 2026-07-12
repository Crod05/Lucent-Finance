import { and, eq } from "drizzle-orm";
import { db, budgetsTable } from "@workspace/db";
import { grantAchievementIfNewInTx, type DbTx } from "./xp";

/**
 * Budget Guardian: a one-time achievement earned by completing a full
 * calendar month at or below EVERY active monthly budget for that month.
 *
 * CAVEATS:
 * - Months are UTC calendar months (see the UTC note in ./xp.ts) — a month is
 *   "completed" once the UTC clock has passed its final midnight, not the
 *   player's local midnight.
 * - Compliance is computed from budgets' `currentSpent`, which sums expense
 *   transactions. Refund/transfer semantics are not formally defined yet: a
 *   refund logged as income does not reduce `currentSpent`, and internal
 *   transfers logged as expenses inflate it. Until transaction semantics are
 *   formalized, this calculation may under- or over-count real spending.
 */

export interface BudgetCompliance {
  monthlyLimit: string | number;
  currentSpent: string | number;
}

/**
 * A month is compliant when it has at least one active budget and every
 * budget's spending is at or below its limit. A month with no budgets is NOT
 * compliant — the badge rewards staying under budgets, not having none.
 */
export function isMonthCompliant(budgets: BudgetCompliance[]): boolean {
  if (budgets.length === 0) return false;
  return budgets.every((b) => Number(b.currentSpent) <= Number(b.monthlyLimit));
}

/** The most recent fully completed UTC calendar month before `now`. */
export function previousCompletedMonth(now: Date = new Date()): {
  year: number;
  month: number;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

/** True when the given UTC calendar month has fully elapsed as of `now`. */
export function isMonthCompleted(
  year: number,
  month: number,
  now: Date = new Date(),
): boolean {
  const endExclusive =
    month === 12 ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, month, 1);
  return now.getTime() >= endExclusive;
}

/**
 * Evaluate Budget Guardian eligibility for a specific year/month and grant
 * the badge idempotently via the existing achievement system (unique on
 * (userId, badgeKey), so repeated evaluation can never duplicate it).
 *
 * Returns true only when the badge was newly granted by this call.
 * Never grants for a month that has not fully completed — a freshly started
 * month with zero spending must not award the badge.
 */
export async function evaluateBudgetGuardianForMonthInTx(
  tx: DbTx,
  year: number,
  month: number,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isMonthCompleted(year, month, now)) return false;

  const budgets = await tx
    .select({
      monthlyLimit: budgetsTable.monthlyLimit,
      currentSpent: budgetsTable.currentSpent,
    })
    .from(budgetsTable)
    .where(and(eq(budgetsTable.year, year), eq(budgetsTable.month, month)));

  if (!isMonthCompliant(budgets)) return false;

  return grantAchievementIfNewInTx(
    tx,
    "budget_guardian",
    "Budget Guardian",
    "Completed a full month at or below every budget",
  );
}

/** Standalone wrapper: opens a transaction and delegates to the InTx form. */
export async function evaluateBudgetGuardianForMonth(
  year: number,
  month: number,
  now: Date = new Date(),
): Promise<boolean> {
  return await db.transaction(async (tx) =>
    evaluateBudgetGuardianForMonthInTx(tx, year, month, now),
  );
}

/** Evaluate the most recent completed month inside the caller's transaction. */
export async function evaluateBudgetGuardianInTx(
  tx: DbTx,
  now: Date = new Date(),
): Promise<boolean> {
  const { year, month } = previousCompletedMonth(now);
  return evaluateBudgetGuardianForMonthInTx(tx, year, month, now);
}

/** Standalone wrapper: opens a transaction and delegates to the InTx form. */
export async function evaluateBudgetGuardian(
  now: Date = new Date(),
): Promise<boolean> {
  return await db.transaction(async (tx) =>
    evaluateBudgetGuardianInTx(tx, now),
  );
}

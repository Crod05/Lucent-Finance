import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  budgetsTable,
  transactionsTable,
  transactionAllocationsTable,
} from "@workspace/db";
import { grantAchievementIfNewInTx, type DbTx } from "./xp";
import {
  evaluateTransactionSemantics,
  type TransactionFacts,
  type TransactionClassification,
  type ClassificationStatus,
  type AllocationRelationshipType,
} from "./transaction-semantics";

/**
 * Budget Guardian: a one-time achievement earned by completing a full
 * calendar month at or below EVERY active monthly budget for that month.
 *
 * Transaction meaning comes EXCLUSIVELY from evaluateTransactionSemantics
 * (docs/transaction-semantics.md) — no classification logic lives here. Only
 * evaluator-approved budget impact is counted: confirmed expenses add to a
 * category, allocated refunds/reimbursements subtract from the original
 * expense's category, transfers and unclassified rows contribute nothing.
 *
 * ELIGIBILITY IS EVALUATOR-DERIVED: compliance is judged exclusively on the
 * evaluator-derived per-category spending. The legacy `budgets.currentSpent`
 * aggregate is display-only and NOT an eligibility guard — a stale
 * `currentSpent` (e.g. one that a valid refund never reduced) must not deny
 * a badge the real semantics have earned, and must not grant one either.
 *
 * CAVEATS:
 * - Months are UTC calendar months (see the UTC note in ./xp.ts) — a month is
 *   "completed" once the UTC clock has passed its final midnight, not the
 *   player's local midnight.
 */

export interface BudgetCompliance {
  monthlyLimit: string | number;
  currentSpent: string | number;
}

/**
 * LEGACY DISPLAY HELPER ONLY — judges the `currentSpent` aggregate that
 * budget pages still show. It is NOT consulted for Budget Guardian
 * eligibility (see `evaluateBudgetGuardianForMonthInTx`).
 *
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

/** Inclusive first / last day (YYYY-MM-DD) of a UTC calendar month. */
function monthRange(year: number, month: number): { first: string; last: string } {
  const first = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { first, last };
}

interface TxRow {
  id: number;
  date: string;
  category: string;
  amount: string;
  classification: string;
  classificationStatus: string;
}

/**
 * Evaluator-derived spending per category for one month.
 *
 * Fact assembly (queries live here; the evaluator itself is pure):
 * 1. Load the month's transactions.
 * 2. Load allocations targeting them (refunds/reimbursements may be logged in
 *    a LATER month but still offset this month's expense) plus the source
 *    transactions of those allocations.
 * 3. Evaluate each distinct transaction once with its full allocation facts.
 * 4. Apply each evaluator budget impact to the category of the transaction it
 *    applies to (self for expenses, the target for offsets) — only when that
 *    transaction belongs to the month being evaluated.
 */
export async function derivedSpentByCategoryInTx(
  tx: DbTx,
  year: number,
  month: number,
): Promise<Map<string, number>> {
  const { first, last } = monthRange(year, month);

  const monthTxs: TxRow[] = await tx
    .select({
      id: transactionsTable.id,
      date: transactionsTable.date,
      category: transactionsTable.category,
      amount: transactionsTable.amount,
      classification: transactionsTable.classification,
      classificationStatus: transactionsTable.classificationStatus,
    })
    .from(transactionsTable)
    .where(and(gte(transactionsTable.date, first), lte(transactionsTable.date, last)));

  if (monthTxs.length === 0) return new Map();

  const monthIds = monthTxs.map((t) => t.id);
  const byId = new Map<number, TxRow>(monthTxs.map((t) => [t.id, t]));

  // Allocations that touch the month's transactions from either side.
  const touching = await tx
    .select()
    .from(transactionAllocationsTable)
    .where(inArray(transactionAllocationsTable.targetTransactionId, monthIds));

  // Pull in out-of-month source transactions of those allocations.
  const extraIds = [
    ...new Set(
      touching.map((a) => a.sourceTransactionId).filter((id) => !byId.has(id)),
    ),
  ];
  if (extraIds.length > 0) {
    const extra: TxRow[] = await tx
      .select({
        id: transactionsTable.id,
        date: transactionsTable.date,
        category: transactionsTable.category,
        amount: transactionsTable.amount,
        classification: transactionsTable.classification,
        classificationStatus: transactionsTable.classificationStatus,
      })
      .from(transactionsTable)
      .where(inArray(transactionsTable.id, extraIds));
    for (const t of extra) byId.set(t.id, t);
  }

  const allIds = [...byId.keys()];
  const allAllocations = await tx
    .select()
    .from(transactionAllocationsTable)
    .where(inArray(transactionAllocationsTable.sourceTransactionId, allIds));

  // A source may split its allocations across targets inside AND outside the
  // month (e.g. one reimbursement covering two months' dinners). Every
  // referenced target's facts must be loaded, or the evaluator would see a
  // phantom "unclassified" target and suppress the legitimate in-month
  // offset (ALLOCATION_TARGET_UNRESOLVED → zero effects → overstated spend).
  const missingTargetIds = [
    ...new Set(
      allAllocations
        .map((a) => a.targetTransactionId)
        .filter((id) => !byId.has(id)),
    ),
  ];
  if (missingTargetIds.length > 0) {
    const extraTargets: TxRow[] = await tx
      .select({
        id: transactionsTable.id,
        date: transactionsTable.date,
        category: transactionsTable.category,
        amount: transactionsTable.amount,
        classification: transactionsTable.classification,
        classificationStatus: transactionsTable.classificationStatus,
      })
      .from(transactionsTable)
      .where(inArray(transactionsTable.id, missingTargetIds));
    for (const t of extraTargets) byId.set(t.id, t);
  }

  const factsFor = (row: TxRow): TransactionFacts => ({
    id: row.id,
    amount: Number(row.amount),
    classification: row.classification as TransactionClassification,
    classificationStatus: row.classificationStatus as ClassificationStatus,
    outgoingAllocations: allAllocations
      .filter((a) => a.sourceTransactionId === row.id)
      .map((a) => {
        const target = byId.get(a.targetTransactionId);
        return {
          relationshipType: a.relationshipType as AllocationRelationshipType,
          allocatedAmount: Number(a.allocatedAmount),
          targetTransactionId: a.targetTransactionId,
          targetClassification: (target?.classification ??
            "unclassified") as TransactionClassification,
          targetClassificationStatus: (target?.classificationStatus ??
            "unclassified") as ClassificationStatus,
        };
      }),
    incomingAllocations: touching
      .filter((a) => a.targetTransactionId === row.id)
      .map((a) => ({
        relationshipType: a.relationshipType as AllocationRelationshipType,
        allocatedAmount: Number(a.allocatedAmount),
        sourceTransactionId: a.sourceTransactionId,
      })),
  });

  const monthIdSet = new Set(monthIds);
  const spent = new Map<string, number>();
  const add = (category: string, amount: number) => {
    spent.set(
      category,
      Math.round(((spent.get(category) ?? 0) + amount) * 100) / 100,
    );
  };

  for (const row of byId.values()) {
    const effects = evaluateTransactionSemantics(factsFor(row));
    for (const impact of effects.budgetImpacts) {
      const appliedTo =
        impact.appliesToTransactionId === null
          ? row
          : byId.get(impact.appliesToTransactionId);
      if (!appliedTo || !monthIdSet.has(appliedTo.id)) continue;
      add(appliedTo.category, impact.amount);
    }
  }
  return spent;
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
      category: budgetsTable.category,
      monthlyLimit: budgetsTable.monthlyLimit,
      currentSpent: budgetsTable.currentSpent,
    })
    .from(budgetsTable)
    .where(and(eq(budgetsTable.year, year), eq(budgetsTable.month, month)));

  // A month with no budgets earns nothing — the badge rewards staying under
  // budgets, not having none.
  if (budgets.length === 0) return false;

  // AUTHORITATIVE compliance: evaluator-derived spending per category must
  // be within each budget's limit. The legacy currentSpent aggregate is
  // deliberately NOT consulted — it can be stale (e.g. never reduced by a
  // valid refund) and must not cause false-negative or false-positive
  // awards.
  const derived = await derivedSpentByCategoryInTx(tx, year, month);
  const derivedCompliant = budgets.every(
    (b) => (derived.get(b.category) ?? 0) <= Number(b.monthlyLimit),
  );
  if (!derivedCompliant) return false;

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

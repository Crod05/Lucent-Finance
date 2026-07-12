import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  evaluateTransactionSemantics,
  type TransactionFacts,
  type TransactionClassification,
} from "../lib/transaction-semantics";

/**
 * Transaction semantics regression suite (docs/transaction-semantics.md).
 *
 * Pure-evaluator tests need no database. DB-backed tests exercise the
 * allocation constraints, the compatibility migration backfill, the manual
 * create/update workflows, and Budget Guardian's consumption of evaluator
 * output.
 */

const ALL_CLASSIFICATIONS: TransactionClassification[] = [
  "expense",
  "income",
  "transfer",
  "refund",
  "reimbursement",
  "investment_contribution",
  "investment_withdrawal",
  "debt_payment",
  "debt_proceeds",
  "fee_interest",
  "adjustment",
  "unclassified",
];

const confirmed = (
  classification: TransactionClassification,
  amount = 100,
  extra: Partial<TransactionFacts> = {},
): TransactionFacts => ({
  id: 1,
  amount,
  classification,
  classificationStatus: "confirmed",
  ...extra,
});

describe("evaluateTransactionSemantics (pure)", () => {
  it("returns a complete result for every classification without throwing", () => {
    for (const classification of ALL_CLASSIFICATIONS) {
      const effects = evaluateTransactionSemantics(confirmed(classification));
      expect(effects.reasonCodes.length).toBeGreaterThan(0);
      expect(typeof effects.explanation).toBe("string");
      expect(["known", "indeterminate"]).toContain(effects.netWorthImpact.status);
      expect(typeof effects.eligibleForGamification).toBe("boolean");
      expect(typeof effects.requiresReview).toBe("boolean");
    }
  });

  it("is synchronous and deterministic (no Promise, identical outputs)", () => {
    const a = evaluateTransactionSemantics(confirmed("expense"));
    const b = evaluateTransactionSemantics(confirmed("expense"));
    expect(a).not.toBeInstanceOf(Promise);
    expect(a).toEqual(b);
  });

  it("confirmed expense: positive spending and budget, no income, known negative net worth", () => {
    const e = evaluateTransactionSemantics(confirmed("expense", 100));
    expect(e.spendingAmount).toBe(100);
    expect(e.budgetAmount).toBe(100);
    expect(e.incomeAmount).toBe(0);
    expect(e.netWorthImpact).toEqual({ status: "known", amount: -100 });
    expect(e.eligibleForGamification).toBe(true);
  });

  it("confirmed income: positive income only", () => {
    const e = evaluateTransactionSemantics(confirmed("income", 100));
    expect(e.incomeAmount).toBe(100);
    expect(e.spendingAmount).toBe(0);
    expect(e.budgetAmount).toBe(0);
    expect(e.netWorthImpact).toEqual({ status: "known", amount: 100 });
  });

  it("transfers produce zero income, spending, and budget impact on BOTH legs", () => {
    const legA = evaluateTransactionSemantics(
      confirmed("transfer", 500, {
        outgoingAllocations: [
          {
            relationshipType: "transfer_pair",
            allocatedAmount: 500,
            targetTransactionId: 2,
            targetClassification: "transfer",
            targetClassificationStatus: "confirmed",
          },
        ],
      }),
    );
    const legB = evaluateTransactionSemantics(
      confirmed("transfer", 500, {
        id: 2,
        incomingAllocations: [
          { relationshipType: "transfer_pair", allocatedAmount: 500, sourceTransactionId: 1 },
        ],
      }),
    );
    for (const leg of [legA, legB]) {
      expect(leg.incomeAmount).toBe(0);
      expect(leg.spendingAmount).toBe(0);
      expect(leg.budgetAmount).toBe(0);
      expect(leg.budgetImpacts).toEqual([]);
      expect(leg.netWorthImpact).toEqual({ status: "known", amount: 0 });
      expect(leg.requiresReview).toBe(false);
    }
    // Unpaired transfer: still neutral, but net worth is indeterminate.
    const lone = evaluateTransactionSemantics(confirmed("transfer", 500));
    expect(lone.spendingAmount).toBe(0);
    expect(lone.netWorthImpact.status).toBe("indeterminate");
  });

  it("allocated refunds reduce spending and budget without ever becoming income", () => {
    const e = evaluateTransactionSemantics(
      confirmed("refund", 100, {
        outgoingAllocations: [
          {
            relationshipType: "refund_of",
            allocatedAmount: 100,
            targetTransactionId: 7,
            targetClassification: "expense",
            targetClassificationStatus: "confirmed",
          },
        ],
      }),
    );
    expect(e.spendingAmount).toBe(-100);
    expect(e.budgetAmount).toBe(-100);
    expect(e.incomeAmount).toBe(0);
    expect(e.budgetImpacts).toEqual([{ appliesToTransactionId: 7, amount: -100 }]);
  });

  it("partial reimbursements reduce ONLY the allocated amount, never income", () => {
    const e = evaluateTransactionSemantics(
      confirmed("reimbursement", 100, {
        outgoingAllocations: [
          {
            relationshipType: "reimbursement_of",
            allocatedAmount: 40,
            targetTransactionId: 7,
            targetClassification: "expense",
            targetClassificationStatus: "confirmed",
          },
        ],
      }),
    );
    expect(e.spendingAmount).toBe(-40);
    expect(e.budgetAmount).toBe(-40);
    expect(e.incomeAmount).toBe(0);
  });

  it("worked example: multiple reimbursements net a $300 dinner to $80, zero earned income", () => {
    const dinner = evaluateTransactionSemantics(confirmed("expense", 300, { id: 10 }));
    const friendA = evaluateTransactionSemantics(
      confirmed("reimbursement", 100, {
        id: 11,
        outgoingAllocations: [
          {
            relationshipType: "reimbursement_of",
            allocatedAmount: 100,
            targetTransactionId: 10,
            targetClassification: "expense",
            targetClassificationStatus: "confirmed",
          },
        ],
      }),
    );
    const friendB = evaluateTransactionSemantics(
      confirmed("reimbursement", 120, {
        id: 12,
        outgoingAllocations: [
          {
            relationshipType: "reimbursement_of",
            allocatedAmount: 120,
            targetTransactionId: 10,
            targetClassification: "expense",
            targetClassificationStatus: "confirmed",
          },
        ],
      }),
    );
    const netSpending =
      dinner.spendingAmount + friendA.spendingAmount + friendB.spendingAmount;
    expect(dinner.spendingAmount).toBe(300);
    expect(netSpending).toBe(80);
    expect(friendA.incomeAmount + friendB.incomeAmount).toBe(0);
  });

  it("over-allocation produces review + zero effects instead of a false reward", () => {
    const e = evaluateTransactionSemantics(
      confirmed("refund", 50, {
        outgoingAllocations: [
          {
            relationshipType: "refund_of",
            allocatedAmount: 80,
            targetTransactionId: 7,
            targetClassification: "expense",
            targetClassificationStatus: "confirmed",
          },
        ],
      }),
    );
    expect(e.requiresReview).toBe(true);
    expect(e.reasonCodes).toContain("OVER_ALLOCATED");
    expect(e.spendingAmount).toBe(0);
    expect(e.eligibleForGamification).toBe(false);
  });

  it("un-allocated refunds/reimbursements require review and have no effect", () => {
    for (const c of ["refund", "reimbursement"] as const) {
      const e = evaluateTransactionSemantics(confirmed(c, 100));
      expect(e.requiresReview).toBe(true);
      expect(e.spendingAmount).toBe(0);
      expect(e.incomeAmount).toBe(0);
      expect(e.eligibleForGamification).toBe(false);
    }
  });

  it("loan proceeds are never income; investment contributions are never spending", () => {
    const loan = evaluateTransactionSemantics(confirmed("debt_proceeds", 5000));
    expect(loan.incomeAmount).toBe(0);
    const invest = evaluateTransactionSemantics(confirmed("investment_contribution", 1000));
    expect(invest.spendingAmount).toBe(0);
    expect(invest.budgetAmount).toBe(0);
  });

  it("unclassified and suggested transactions block ALL effects and gamification evidence", () => {
    const un = evaluateTransactionSemantics({
      id: 1,
      amount: 100,
      classification: "unclassified",
      classificationStatus: "unclassified",
    });
    const sug = evaluateTransactionSemantics({
      id: 1,
      amount: 100,
      classification: "expense",
      classificationStatus: "suggested",
    });
    for (const e of [un, sug]) {
      expect(e.eligibleForGamification).toBe(false);
      expect(e.requiresReview).toBe(true);
      expect(e.incomeAmount).toBe(0);
      expect(e.spendingAmount).toBe(0);
      expect(e.budgetAmount).toBe(0);
      expect(e.budgetImpacts).toEqual([]);
    }
    expect(un.reasonCodes).toContain("UNCLASSIFIED");
    expect(sug.reasonCodes).toContain("SUGGESTED_UNRESOLVED");
  });

  it("net-worth impact is a discriminated union and indeterminate cases carry a reason", () => {
    const e = evaluateTransactionSemantics(confirmed("debt_payment", 200));
    expect(e.netWorthImpact.status).toBe("indeterminate");
    if (e.netWorthImpact.status === "indeterminate") {
      expect(e.netWorthImpact.reason.length).toBeGreaterThan(0);
    }
  });

  it("PURITY: the evaluator module imports no database code", () => {
    const src = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../lib/transaction-semantics.ts",
      ),
      "utf8",
    );
    expect(src).not.toMatch(/@workspace\/db/);
    expect(src).not.toMatch(/drizzle/);
    expect(src).not.toMatch(/\bawait\b/);
    expect(src).not.toMatch(/async/);
  });
});

describe("transaction semantics (DB)", () => {
  let server: Server;
  let baseUrl: string;
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let allocations: typeof import("../lib/allocations");
  let guardian: typeof import("../lib/budget-guardian");

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    schema = await import("@workspace/db");
    db = schema.db;
    allocations = await import("../lib/allocations");
    guardian = await import("../lib/budget-guardian");
    const { default: app } = await import("../app");
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server?.close();
  });

  const insertTx = async (values: {
    date: string;
    description: string;
    amount: number;
    category?: string;
    type?: string;
    classification?: string;
    classificationStatus?: string;
    classificationConfidence?: string;
    classificationSource?: string;
  }) => {
    const [row] = await db
      .insert(schema.transactionsTable)
      .values({
        category: "Semantics",
        type: "expense",
        ...values,
        amount: values.amount.toFixed(2),
      })
      .returning();
    return row;
  };

  it("no stored policy boolean columns exist on transactions", async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'transactions'
    `);
    const names = cols.rows.map((r) => r.column_name);
    for (const forbidden of [
      "counts_toward_budget",
      "counts_as_income",
      "counts_as_spending",
      "eligible_for_gamification",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    // The semantic FACT columns do exist.
    for (const fact of [
      "classification",
      "classification_status",
      "classification_confidence",
      "classification_source",
    ]) {
      expect(names).toContain(fact);
    }
  });

  describe("transaction_allocations constraints", () => {
    it("rejects self-allocation, non-positive amounts, and invalid relationship types", async () => {
      const t = await insertTx({
        date: "2026-02-01",
        description: "Alloc constraint base",
        amount: 100,
      });
      await expect(
        allocations.createAllocation({
          sourceTransactionId: t.id,
          targetTransactionId: t.id,
          relationshipType: "refund_of",
          allocatedAmount: 10,
        }),
      ).rejects.toMatchObject({ code: "SELF_ALLOCATION" });
      await expect(
        allocations.createAllocation({
          sourceTransactionId: t.id,
          targetTransactionId: t.id + 999999,
          relationshipType: "refund_of",
          allocatedAmount: 0,
        }),
      ).rejects.toMatchObject({ code: "NON_POSITIVE_AMOUNT" });

      // The database itself enforces the same rules (defense in depth).
      await expect(
        db.execute(sql`
          INSERT INTO transaction_allocations
            (source_transaction_id, target_transaction_id, relationship_type, allocated_amount)
          VALUES (${t.id}, ${t.id}, 'refund_of', 10)
        `),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`
          INSERT INTO transaction_allocations
            (source_transaction_id, target_transaction_id, relationship_type, allocated_amount)
          VALUES (${t.id}, ${t.id + 1}, 'made_up_type', 10)
        `),
      ).rejects.toThrow();
    });

    it("rejects over-allocation beyond the target's original amount — never silently", async () => {
      const dinner = await insertTx({
        date: "2026-02-02",
        description: "Overalloc dinner",
        amount: 300,
        classification: "expense",
        classificationStatus: "confirmed",
      });
      const reimbA = await insertTx({
        date: "2026-02-03",
        description: "Overalloc reimb A",
        amount: 200,
        type: "income",
        classification: "reimbursement",
        classificationStatus: "confirmed",
      });
      const reimbB = await insertTx({
        date: "2026-02-04",
        description: "Overalloc reimb B",
        amount: 200,
        type: "income",
        classification: "reimbursement",
        classificationStatus: "confirmed",
      });

      await allocations.createAllocation({
        sourceTransactionId: reimbA.id,
        targetTransactionId: dinner.id,
        relationshipType: "reimbursement_of",
        allocatedAmount: 200,
      });
      // 200 already allocated against a 300 expense: another 150 must fail.
      await expect(
        allocations.createAllocation({
          sourceTransactionId: reimbB.id,
          targetTransactionId: dinner.id,
          relationshipType: "reimbursement_of",
          allocatedAmount: 150,
        }),
      ).rejects.toMatchObject({ code: "TARGET_OVER_ALLOCATED" });
      // ...but the remaining 100 is fine (multiple partial reimbursements).
      await allocations.createAllocation({
        sourceTransactionId: reimbB.id,
        targetTransactionId: dinner.id,
        relationshipType: "reimbursement_of",
        allocatedAmount: 100,
      });
    });

    it("rejects a source handing out more than its own amount", async () => {
      const e1 = await insertTx({
        date: "2026-02-05",
        description: "Split target 1",
        amount: 100,
        classification: "expense",
        classificationStatus: "confirmed",
      });
      const e2 = await insertTx({
        date: "2026-02-06",
        description: "Split target 2",
        amount: 100,
        classification: "expense",
        classificationStatus: "confirmed",
      });
      const refund = await insertTx({
        date: "2026-02-07",
        description: "Split refund",
        amount: 120,
        type: "income",
        classification: "refund",
        classificationStatus: "confirmed",
      });
      await allocations.createAllocation({
        sourceTransactionId: refund.id,
        targetTransactionId: e1.id,
        relationshipType: "refund_of",
        allocatedAmount: 80,
      });
      await expect(
        allocations.createAllocation({
          sourceTransactionId: refund.id,
          targetTransactionId: e2.id,
          relationshipType: "refund_of",
          allocatedAmount: 60, // 80 + 60 > 120
        }),
      ).rejects.toMatchObject({ code: "SOURCE_OVER_ALLOCATED" });
    });
  });

  describe("compatibility migration backfill", () => {
    it("the checked-in migration maps legacy income/expense to confirmed/high/legacy_type", async () => {
      // Recreate pre-migration rows (defaults = unclassified facts), then
      // execute the exact backfill statement from the checked-in migration.
      const legacyExpense = await insertTx({
        date: "2026-02-10",
        description: "Legacy expense row",
        amount: 10,
        type: "expense",
      });
      const legacyIncome = await insertTx({
        date: "2026-02-11",
        description: "Legacy income row",
        amount: 10,
        type: "income",
      });
      const weird = await insertTx({
        date: "2026-02-12",
        description: "Legacy unmappable row",
        amount: 10,
        type: "mystery",
      });

      const drizzleDir = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../lib/db/drizzle",
      );
      const migrationFile = readdirSync(drizzleDir).find((f) =>
        f.startsWith("0002_"),
      );
      expect(migrationFile).toBeDefined();
      const migrationSql = readFileSync(path.join(drizzleDir, migrationFile!), "utf8");
      const backfill = migrationSql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .find((s) => s.startsWith("UPDATE"));
      expect(backfill).toBeDefined();
      await db.execute(sql.raw(backfill!));

      const rows = await db
        .select()
        .from(schema.transactionsTable)
        .where(
          inArray(schema.transactionsTable.id, [
            legacyExpense.id,
            legacyIncome.id,
            weird.id,
          ]),
        );
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(legacyExpense.id)).toMatchObject({
        classification: "expense",
        classificationStatus: "confirmed",
        classificationConfidence: "high",
        classificationSource: "legacy_type",
      });
      expect(byId.get(legacyIncome.id)).toMatchObject({
        classification: "income",
        classificationStatus: "confirmed",
        classificationConfidence: "high",
        classificationSource: "legacy_type",
      });
      // Unmappable rows remain unclassified.
      expect(byId.get(weird.id)).toMatchObject({
        classification: "unclassified",
        classificationStatus: "unclassified",
      });
    });
  });

  describe("manual create/update workflows stay compatible", () => {
    it("POST /transactions stores an explicit confirmed classification and still awards XP", async () => {
      const res = await fetch(`${baseUrl}/api/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: "2026-02-15",
          description: "Manual classify check",
          amount: 21.5,
          category: "Semantics",
          type: "expense",
        }),
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: number };
      const [row] = await db
        .select()
        .from(schema.transactionsTable)
        .where(eq(schema.transactionsTable.id, created.id));
      expect(row).toMatchObject({
        classification: "expense",
        classificationStatus: "confirmed",
        classificationConfidence: "high",
        classificationSource: "user",
      });
      const xp = await db
        .select()
        .from(schema.xpEventsTable)
        .where(
          and(
            eq(schema.xpEventsTable.eventType, "transaction_created"),
            eq(schema.xpEventsTable.sourceId, row.fingerprint!),
          ),
        );
      expect(xp).toHaveLength(1);
    });

    it("PATCH type change keeps the classification facts in sync", async () => {
      const created = await (
        await fetch(`${baseUrl}/api/transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: "2026-02-16",
            description: "Patch classify check",
            amount: 5,
            category: "Semantics",
            type: "expense",
          }),
        })
      ).json() as { id: number };
      const res = await fetch(`${baseUrl}/api/transactions/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "income" }),
      });
      expect(res.status).toBe(200);
      const [row] = await db
        .select()
        .from(schema.transactionsTable)
        .where(eq(schema.transactionsTable.id, created.id));
      expect(row).toMatchObject({
        type: "income",
        classification: "income",
        classificationStatus: "confirmed",
        classificationSource: "user",
      });
    });
  });

  describe("Budget Guardian consumes evaluator output", () => {
    const NOW = new Date("2026-07-11T12:00:00Z");
    const YEAR = 2026;
    const MONTH = 3; // March 2026 — completed, unused by other suites.

    beforeEach(async () => {
      await db
        .delete(schema.earnedAchievementsTable)
        .where(eq(schema.earnedAchievementsTable.badgeKey, "budget_guardian"));
      await db
        .delete(schema.budgetsTable)
        .where(
          and(eq(schema.budgetsTable.year, YEAR), eq(schema.budgetsTable.month, MONTH)),
        );
      const marchTxs = await db
        .select({ id: schema.transactionsTable.id })
        .from(schema.transactionsTable)
        .where(
          and(
            sql`${schema.transactionsTable.date} >= '2026-03-01'`,
            sql`${schema.transactionsTable.date} <= '2026-03-31'`,
          ),
        );
      if (marchTxs.length > 0) {
        await db.delete(schema.transactionsTable).where(
          inArray(
            schema.transactionsTable.id,
            marchTxs.map((t) => t.id),
          ),
        );
      }
    });

    const badgeCount = async () =>
      (
        await db
          .select()
          .from(schema.earnedAchievementsTable)
          .where(eq(schema.earnedAchievementsTable.badgeKey, "budget_guardian"))
      ).length;

    it("derived spending over the limit blocks the badge even when currentSpent looks fine", async () => {
      await db.insert(schema.budgetsTable).values({
        category: "SemDining",
        monthlyLimit: "500.00",
        currentSpent: "0.00",
        month: MONTH,
        year: YEAR,
      });
      await insertTx({
        date: "2026-03-05",
        description: "March overspend",
        amount: 600,
        category: "SemDining",
        classification: "expense",
        classificationStatus: "confirmed",
      });
      expect(await guardian.evaluateBudgetGuardianForMonth(YEAR, MONTH, NOW)).toBe(false);
      expect(await badgeCount()).toBe(0);
    });

    it("an evaluator-approved refund allocation brings the month back under budget", async () => {
      await db.insert(schema.budgetsTable).values({
        category: "SemDining",
        monthlyLimit: "500.00",
        currentSpent: "0.00",
        month: MONTH,
        year: YEAR,
      });
      const spend = await insertTx({
        date: "2026-03-05",
        description: "March overspend refunded",
        amount: 600,
        category: "SemDining",
        classification: "expense",
        classificationStatus: "confirmed",
      });
      const refund = await insertTx({
        date: "2026-04-02", // refund lands the NEXT month, still offsets March
        description: "March refund",
        amount: 150,
        type: "income",
        classification: "refund",
        classificationStatus: "confirmed",
      });
      await allocations.createAllocation({
        sourceTransactionId: refund.id,
        targetTransactionId: spend.id,
        relationshipType: "refund_of",
        allocatedAmount: 150,
      });

      const derived = await db.transaction(async (tx) =>
        guardian.derivedSpentByCategoryInTx(tx, YEAR, MONTH),
      );
      expect(derived.get("SemDining")).toBe(450);

      expect(await guardian.evaluateBudgetGuardianForMonth(YEAR, MONTH, NOW)).toBe(true);
      expect(await badgeCount()).toBe(1);
    });

    it("a source split across in-month and out-of-month targets still offsets the in-month expense", async () => {
      await db.insert(schema.budgetsTable).values({
        category: "SemDining",
        monthlyLimit: "500.00",
        currentSpent: "0.00",
        month: MONTH,
        year: YEAR,
      });
      const marchDinner = await insertTx({
        date: "2026-03-06",
        description: "March split dinner",
        amount: 600,
        category: "SemDining",
        classification: "expense",
        classificationStatus: "confirmed",
      });
      const aprilDinner = await insertTx({
        date: "2026-04-06",
        description: "April split dinner",
        amount: 200,
        category: "SemDining",
        classification: "expense",
        classificationStatus: "confirmed",
      });
      // One reimbursement covers BOTH months' dinners. The April target lives
      // outside the evaluated month; its facts must still be loaded so the
      // evaluator doesn't see a phantom unresolved target and suppress the
      // legitimate March offset.
      const reimb = await insertTx({
        date: "2026-04-10",
        description: "Split reimbursement",
        amount: 250,
        type: "income",
        classification: "reimbursement",
        classificationStatus: "confirmed",
      });
      await allocations.createAllocation({
        sourceTransactionId: reimb.id,
        targetTransactionId: marchDinner.id,
        relationshipType: "reimbursement_of",
        allocatedAmount: 150,
      });
      await allocations.createAllocation({
        sourceTransactionId: reimb.id,
        targetTransactionId: aprilDinner.id,
        relationshipType: "reimbursement_of",
        allocatedAmount: 100,
      });

      const derived = await db.transaction(async (tx) =>
        guardian.derivedSpentByCategoryInTx(tx, YEAR, MONTH),
      );
      // 600 − 150 (only the March-allocated share) = 450 ≤ 500.
      expect(derived.get("SemDining")).toBe(450);
      expect(await guardian.evaluateBudgetGuardianForMonth(YEAR, MONTH, NOW)).toBe(true);

      // Clean up the April rows so they can't bleed into other scenarios.
      await db
        .delete(schema.transactionsTable)
        .where(inArray(schema.transactionsTable.id, [aprilDinner.id, reimb.id]));
    });

    it("unclassified and transfer transactions contribute NOTHING to derived budget spending", async () => {
      await db.insert(schema.budgetsTable).values({
        category: "SemDining",
        monthlyLimit: "100.00",
        currentSpent: "0.00",
        month: MONTH,
        year: YEAR,
      });
      // Both of these would blow the budget if (mis)counted.
      await insertTx({
        date: "2026-03-10",
        description: "March unclassified",
        amount: 9999,
        category: "SemDining",
        // defaults: unclassified facts
      });
      await insertTx({
        date: "2026-03-11",
        description: "March transfer",
        amount: 8888,
        category: "SemDining",
        classification: "transfer",
        classificationStatus: "confirmed",
      });
      const derived = await db.transaction(async (tx) =>
        guardian.derivedSpentByCategoryInTx(tx, YEAR, MONTH),
      );
      expect(derived.get("SemDining") ?? 0).toBe(0);
      expect(await guardian.evaluateBudgetGuardianForMonth(YEAR, MONTH, NOW)).toBe(true);
    });

    it("legacy currentSpent over the limit still blocks the badge (conservative dual guard)", async () => {
      await db.insert(schema.budgetsTable).values({
        category: "SemDining",
        monthlyLimit: "100.00",
        currentSpent: "100.01",
        month: MONTH,
        year: YEAR,
      });
      expect(await guardian.evaluateBudgetGuardianForMonth(YEAR, MONTH, NOW)).toBe(false);
    });
  });
});

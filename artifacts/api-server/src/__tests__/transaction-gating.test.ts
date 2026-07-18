import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and } from "drizzle-orm";

/**
 * Behavioral gating tests for POST /transactions (defect-remediation §3).
 *
 * The manual API always creates confirmed rows, so an ineligible evaluator
 * result is unreachable through real inputs today. To exercise the route's
 * gate behaviorally, we wrap the REAL evaluator and force an ineligible
 * result on demand — everything else (route, transaction boundary, XP
 * helpers, Budget Guardian) is fully real and DB-backed.
 */

const gate = vi.hoisted(() => ({ forceIneligible: false }));

vi.mock("../lib/transaction-semantics", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/transaction-semantics")>();
  return {
    ...actual,
    evaluateTransactionSemantics: (
      facts: Parameters<typeof actual.evaluateTransactionSemantics>[0],
    ) => {
      const real = actual.evaluateTransactionSemantics(facts);
      if (!gate.forceIneligible) return real;
      return {
        ...real,
        guardianEligible: false,
        questEvidenceEligible: false,
        chapterEvidenceEligible: false,
        eligibleForGamification: false,
        requiresReview: true,
        reasonCodes: ["FORCED_INELIGIBLE_TEST"],
      };
    },
  };
});

describe("POST /transactions gates the ENTIRE gamification chain on eligibility", () => {
  let server: Server;
  let baseUrl: string;
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");

  // Previous completed UTC month — the month Budget Guardian evaluates.
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevYear = prev.getUTCFullYear();
  const prevMonth = prev.getUTCMonth() + 1;
  const todayIso = now.toISOString().slice(0, 10);

  const badgeCount = async () => {
    const rows = await db
      .select()
      .from(schema.earnedAchievementsTable)
      .where(eq(schema.earnedAchievementsTable.badgeKey, "budget_guardian"));
    return rows.length;
  };

  const tableCounts = async () => ({
    xp: (await db.select().from(schema.xpEventsTable)).length,
    achievements: (await db.select().from(schema.earnedAchievementsTable)).length,
    bonus: (await db.select().from(schema.bonusMissionsTable)).length,
    missionsCompleted: (
      await db
        .select()
        .from(schema.dailyMissionsTable)
        .where(eq(schema.dailyMissionsTable.status, "completed"))
    ).length,
  });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    schema = await import("@workspace/db");
    db = schema.db;
    const { default: app } = await import("../app");
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // A compliant previous month so Budget Guardian WOULD grant if it ran.
    await db
      .delete(schema.earnedAchievementsTable)
      .where(eq(schema.earnedAchievementsTable.badgeKey, "budget_guardian"));
    await db
      .delete(schema.budgetsTable)
      .where(
        and(
          eq(schema.budgetsTable.year, prevYear),
          eq(schema.budgetsTable.month, prevMonth),
        ),
      );
    await db.insert(schema.budgetsTable).values({
      category: "GatingCat",
      monthlyLimit: "9999999.00",
      currentSpent: "0.00",
      month: prevMonth,
      year: prevYear,
    });
  });

  afterAll(async () => {
    gate.forceIneligible = false;
    await db
      .delete(schema.budgetsTable)
      .where(eq(schema.budgetsTable.category, "GatingCat"));
    await db
      .delete(schema.earnedAchievementsTable)
      .where(eq(schema.earnedAchievementsTable.badgeKey, "budget_guardian"));
    server?.close();
  });

  const post = (description: string) =>
    fetch(`${baseUrl}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: todayIso,
        description,
        amount: 5.55,
        category: "GatingCat",
        type: "expense",
      }),
    });

  it("an ineligible result runs NO gamification helper: no XP, achievements, missions, bonus, streaks, or Budget Guardian", async () => {
    gate.forceIneligible = true;
    const before = await tableCounts();
    const [progressBefore] = await db.select().from(schema.userProgressTable);

    const res = await post("Gating ineligible probe");
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: number };

    // The financial row itself IS created…
    const [row] = await db
      .select()
      .from(schema.transactionsTable)
      .where(eq(schema.transactionsTable.id, created.id));
    expect(row).toBeDefined();

    // …but the entire reward/evidence chain is skipped.
    const after = await tableCounts();
    expect(after).toEqual(before);
    expect(await badgeCount()).toBe(0); // guardian did not run/grant

    const [progressAfter] = await db.select().from(schema.userProgressTable);
    expect(progressAfter?.totalXp).toBe(progressBefore?.totalXp);
    expect(progressAfter?.currentStreak).toBe(progressBefore?.currentStreak);
  });

  it("the same setup DOES reward an eligible transaction (proving the ineligible skip was the gate)", async () => {
    gate.forceIneligible = false;
    const res = await post("Gating eligible probe");
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: number };
    const [row] = await db
      .select()
      .from(schema.transactionsTable)
      .where(eq(schema.transactionsTable.id, created.id));

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
    // Budget Guardian ran (guardianEligible === true) and granted the badge
    // for the compliant previous month.
    expect(await badgeCount()).toBe(1);
  });
});

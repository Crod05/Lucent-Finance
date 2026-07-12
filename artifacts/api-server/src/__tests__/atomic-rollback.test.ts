import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and } from "drizzle-orm";
import { setFailpointHandler } from "../lib/failpoints";

/**
 * Atomicity tests: one user action = one database transaction.
 *
 * Failure injection uses the test-only failpoint handler (dependency
 * injection in-process) — there is no HTTP- or env-reachable switch. A
 * handler that throws at a named point inside a route's transaction must
 * roll back EVERYTHING that action wrote: the financial row AND all
 * gamification state (xp_events, daily/bonus missions, achievements,
 * user_progress), and the client must get a generic 500.
 */
describe("atomic action + gamification writes", () => {
  let server: Server;
  let baseUrl: string;
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    schema = await import("@workspace/db");
    db = schema.db;
    const { default: app } = await import("../app");
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server?.close();
  });

  afterEach(() => {
    setFailpointHandler(null);
  });

  const failAt = (name: string) =>
    setFailpointHandler((point) => {
      if (point === name) throw new Error(`injected failure at ${name}`);
    });

  const post = (path: string, body?: object) =>
    fetch(`${baseUrl}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

  const patch = (path: string, body?: object) =>
    fetch(`${baseUrl}/api${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

  /**
   * Full snapshot of every gamification table plus user progress. Comparing
   * snapshots before and after a failed action proves nothing leaked —
   * regardless of what previous tests already wrote.
   */
  const gamificationSnapshot = async () => {
    const byId = <T extends { id: number }>(rows: T[]) => [...rows].sort((a, b) => a.id - b.id);
    const [xp, missions, bonuses, achievements, progress] = await Promise.all([
      db.select().from(schema.xpEventsTable),
      db.select().from(schema.dailyMissionsTable),
      db.select().from(schema.bonusMissionsTable),
      db.select().from(schema.earnedAchievementsTable),
      db.select().from(schema.userProgressTable),
    ]);
    return JSON.parse(
      JSON.stringify({
        xp: byId(xp),
        missions: byId(missions),
        bonuses: byId(bonuses),
        achievements: byId(achievements),
        progress,
      })
    );
  };

  const txnBody = (description: string) => ({
    date: "2026-07-12",
    description,
    amount: 33.33,
    category: "Food",
    type: "expense",
  });

  const txnRowsFor = async (description: string) =>
    db
      .select()
      .from(schema.transactionsTable)
      .where(eq(schema.transactionsTable.description, description));

  const expectGeneric500 = async (res: Response) => {
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "Internal server error" });
  };

  describe("failure-injection rollbacks", () => {
    it("POST /transactions: failure right after the insert rolls back the transaction row and all gamification state", async () => {
      const before = await gamificationSnapshot();
      failAt("transaction.afterInsert");

      const res = await post("/transactions", txnBody("Rollback A groceries"));
      await expectGeneric500(res);

      expect(await txnRowsFor("Rollback A groceries")).toHaveLength(0);
      expect(await gamificationSnapshot()).toEqual(before);
    });

    it("POST /transactions: failure after mission completion rolls back the insert, XP, mission, and streak together", async () => {
      const before = await gamificationSnapshot();
      failAt("transaction.afterMission");

      const res = await post("/transactions", txnBody("Rollback B groceries"));
      await expectGeneric500(res);

      expect(await txnRowsFor("Rollback B groceries")).toHaveLength(0);
      expect(await gamificationSnapshot()).toEqual(before);
    });

    it("a rolled-back transaction can be re-submitted successfully once the failure clears", async () => {
      failAt("transaction.afterInsert");
      await expectGeneric500(await post("/transactions", txnBody("Rollback C groceries")));

      setFailpointHandler(null);
      const retry = await post("/transactions", txnBody("Rollback C groceries"));
      expect(retry.status).toBe(201);
      expect(await txnRowsFor("Rollback C groceries")).toHaveLength(1);
    });

    it("PATCH /bills/:id/pay: failure right after the status flip leaves the bill unpaid and gamification untouched", async () => {
      const create = await post("/bills", {
        name: "Rollback Electric",
        amount: 80,
        frequency: "monthly",
        dueDate: "2026-07-20",
        category: "Utilities",
      });
      expect(create.status).toBe(201);
      const bill = (await create.json()) as { id: number };

      const before = await gamificationSnapshot();
      failAt("bill.afterPaid");

      const res = await patch(`/bills/${bill.id}/pay`);
      await expectGeneric500(res);

      const [row] = await db
        .select()
        .from(schema.billsTable)
        .where(eq(schema.billsTable.id, bill.id));
      expect(row.status).not.toBe("paid");
      expect(await gamificationSnapshot()).toEqual(before);
    });

    it("PATCH /bills/:id/pay: failure after mission completion rolls back the paid flip, XP, and achievement together", async () => {
      const create = await post("/bills", {
        name: "Rollback Water",
        amount: 45,
        frequency: "monthly",
        dueDate: "2026-07-22",
        category: "Utilities",
      });
      const bill = (await create.json()) as { id: number };

      const before = await gamificationSnapshot();
      failAt("bill.afterMission");

      const res = await patch(`/bills/${bill.id}/pay`);
      await expectGeneric500(res);

      const [row] = await db
        .select()
        .from(schema.billsTable)
        .where(eq(schema.billsTable.id, bill.id));
      expect(row.status).not.toBe("paid");
      expect(await gamificationSnapshot()).toEqual(before);

      // And once the failure clears, paying works and awards exactly once.
      setFailpointHandler(null);
      const pay = await patch(`/bills/${bill.id}/pay`);
      expect(pay.status).toBe(200);
      const events = await db
        .select()
        .from(schema.xpEventsTable)
        .where(
          and(
            eq(schema.xpEventsTable.eventType, "bill_paid"),
            eq(schema.xpEventsTable.sourceId, String(bill.id))
          )
        );
      expect(events).toHaveLength(1);
    });
  });

  describe("success paths still work (regression)", () => {
    it("POST /transactions awards action XP exactly once, keyed on the fingerprint", async () => {
      const res = await post("/transactions", txnBody("Atomic success coffee"));
      expect(res.status).toBe(201);

      const [row] = await txnRowsFor("Atomic success coffee");
      expect(row.fingerprint).toBeTruthy();
      const events = await db
        .select()
        .from(schema.xpEventsTable)
        .where(
          and(
            eq(schema.xpEventsTable.eventType, "transaction_created"),
            eq(schema.xpEventsTable.sourceId, row.fingerprint as string)
          )
        );
      expect(events).toHaveLength(1);
      expect(events[0].xpAmount).toBe(10);
    });

    it("duplicate create still returns 409 inside the transaction and writes nothing", async () => {
      const before = await gamificationSnapshot();
      const dup = await post("/transactions", txnBody("Atomic success coffee"));
      expect(dup.status).toBe(409);
      const body = (await dup.json()) as { duplicate: boolean; existingId?: number };
      expect(body.duplicate).toBe(true);
      expect(body.existingId).toBeDefined();
      expect(await gamificationSnapshot()).toEqual(before);
      expect(await txnRowsFor("Atomic success coffee")).toHaveLength(1);
    });

    it("concurrent pays of the same bill award bill XP exactly once", async () => {
      const create = await post("/bills", {
        name: "Concurrent Internet",
        amount: 60,
        frequency: "monthly",
        dueDate: "2026-07-25",
        category: "Utilities",
      });
      const bill = (await create.json()) as { id: number };

      const [a, b] = await Promise.all([
        patch(`/bills/${bill.id}/pay`),
        patch(`/bills/${bill.id}/pay`),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);

      const events = await db
        .select()
        .from(schema.xpEventsTable)
        .where(
          and(
            eq(schema.xpEventsTable.eventType, "bill_paid"),
            eq(schema.xpEventsTable.sourceId, String(bill.id))
          )
        );
      expect(events).toHaveLength(1);
    });

    it("POST /budgets/reviewed and POST /insights/viewed are idempotent across repeat posts", async () => {
      const r1 = await post("/budgets/reviewed");
      expect(r1.status).toBe(200);
      const i1 = await post("/insights/viewed");
      expect(i1.status).toBe(200);

      const before = await gamificationSnapshot();
      const r2 = await post("/budgets/reviewed");
      expect(r2.status).toBe(200);
      expect(((await r2.json()) as { xpAwarded: number }).xpAwarded).toBe(0);
      const i2 = await post("/insights/viewed");
      expect(i2.status).toBe(200);
      expect(((await i2.json()) as { xpAwarded: number }).xpAwarded).toBe(0);
      expect(await gamificationSnapshot()).toEqual(before);
    });

    it("GET endpoints remain side-effect free", async () => {
      const before = await gamificationSnapshot();
      for (const path of [
        "/gamification/progress",
        "/gamification/missions/today",
        "/gamification/briefing",
        "/gamification/achievements",
      ]) {
        const res = await fetch(`${baseUrl}/api${path}`);
        expect(res.status).toBe(200);
      }
      expect(await gamificationSnapshot()).toEqual(before);
    });
  });
});

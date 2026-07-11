import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { computeFingerprint } from "../lib/fingerprint";

describe("computeFingerprint", () => {
  const base = {
    date: "2026-01-15",
    description: "Coffee Shop",
    amount: 4.5,
    type: "expense",
    accountId: null,
  };

  it("is deterministic", () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint({ ...base }));
  });

  it("normalizes description whitespace and case", () => {
    expect(computeFingerprint({ ...base, description: "  COFFEE   shop " })).toBe(
      computeFingerprint(base)
    );
  });

  it("normalizes amount formatting", () => {
    expect(computeFingerprint({ ...base, amount: "4.50" })).toBe(computeFingerprint(base));
  });

  it("changes when any producing field changes", () => {
    const fp = computeFingerprint(base);
    expect(computeFingerprint({ ...base, date: "2026-01-16" })).not.toBe(fp);
    expect(computeFingerprint({ ...base, description: "Tea Shop" })).not.toBe(fp);
    expect(computeFingerprint({ ...base, amount: 4.51 })).not.toBe(fp);
    expect(computeFingerprint({ ...base, type: "income" })).not.toBe(fp);
    expect(computeFingerprint({ ...base, accountId: 7 })).not.toBe(fp);
  });
});

describe("transaction duplicate handling (API)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    const { default: app } = await import("../app");
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server?.close();
  });

  const post = (body: object) =>
    fetch(`${baseUrl}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const patch = (id: number, body: object) =>
    fetch(`${baseUrl}/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const txn = (overrides: object = {}) => ({
    date: "2026-06-10",
    description: "Duplicate Test Groceries",
    amount: 42.42,
    category: "Food",
    type: "expense",
    ...overrides,
  });

  it("creates a transaction, then returns 409 with duplicate indicator on an identical create", async () => {
    const first = await post(txn());
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: number };

    const second = await post(txn());
    expect(second.status).toBe(409);
    const body = (await second.json()) as { duplicate: boolean; existingId: number; error: string };
    expect(body.duplicate).toBe(true);
    expect(body.existingId).toBe(created.id);
    expect(body.error).toMatch(/duplicate/i);
  });

  it("treats normalized variants (case/whitespace) as duplicates", async () => {
    const res = await post(txn({ description: "  duplicate   TEST groceries " }));
    expect(res.status).toBe(409);
  });

  it("only one of two concurrent identical creates succeeds", async () => {
    const body = txn({ description: "Concurrent Create Race", amount: 9.99 });
    const [a, b] = await Promise.all([post(body), post(body)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("returns 409 when an update would collide with an existing transaction", async () => {
    const other = await post(txn({ description: "Different Item", amount: 5 }));
    expect(other.status).toBe(201);
    const otherRow = (await other.json()) as { id: number };

    // Make "Different Item" identical to "Duplicate Test Groceries".
    const collide = await patch(otherRow.id, {
      description: "Duplicate Test Groceries",
      amount: 42.42,
    });
    expect(collide.status).toBe(409);
    const body = (await collide.json()) as { duplicate: boolean; existingId: number };
    expect(body.duplicate).toBe(true);
    expect(typeof body.existingId).toBe("number");
  });

  it("normalizes a date update so dedup still applies (regression)", async () => {
    // Two rows differing only by date.
    const a = await post(txn({ description: "Date Move Check", amount: 7.77, date: "2026-06-01" }));
    expect(a.status).toBe(201);
    const b = await post(txn({ description: "Date Move Check", amount: 7.77, date: "2026-06-02" }));
    expect(b.status).toBe(201);
    const bRow = (await b.json()) as { id: number };

    // Moving B onto A's date makes them identical — must be a 409, which
    // only happens if the PATCHed date is normalized to YYYY-MM-DD before
    // fingerprinting (Zod coerces the body date to a Date object).
    const collide = await patch(bRow.id, { date: "2026-06-01" });
    expect(collide.status).toBe(409);

    // A date-only move to a free date succeeds and stays canonical: an
    // identical create against the new date must then be rejected.
    const move = await patch(bRow.id, { date: "2026-06-03" });
    expect(move.status).toBe(200);
    const moved = (await move.json()) as { date: string };
    // Response serialization is ISO; the calendar day must be the new date.
    expect(moved.date.startsWith("2026-06-03")).toBe(true);
    const dup = await post(txn({ description: "Date Move Check", amount: 7.77, date: "2026-06-03" }));
    expect(dup.status).toBe(409);
  });

  it("allows a non-colliding update and keeps the fingerprint in sync", async () => {
    const res = await post(txn({ description: "Update Sync Check", amount: 11 }));
    expect(res.status).toBe(201);
    const row = (await res.json()) as { id: number };

    const upd = await patch(row.id, { amount: 12 });
    expect(upd.status).toBe(200);

    // The fingerprint must now reflect amount=12: an identical create is a duplicate...
    const dup = await post(txn({ description: "Update Sync Check", amount: 12 }));
    expect(dup.status).toBe(409);
    // ...and the old amount=11 shape is free again.
    const old = await post(txn({ description: "Update Sync Check", amount: 11 }));
    expect(old.status).toBe(201);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  transactionEvidenceRef,
  parseTransactionEvidenceRef,
  findOrphanedTransactionEvidenceRefs,
} from "../lib/evidence";

describe("transaction evidence reference helpers", () => {
  it("builds the canonical format", () => {
    expect(transactionEvidenceRef(42)).toBe("transaction:42");
  });

  it("round-trips build/parse", () => {
    expect(parseTransactionEvidenceRef(transactionEvidenceRef(7))).toBe(7);
  });

  it("returns null for other kinds, malformed, and empty refs", () => {
    expect(parseTransactionEvidenceRef("bill:9")).toBeNull();
    expect(parseTransactionEvidenceRef("transaction:")).toBeNull();
    expect(parseTransactionEvidenceRef("transaction:abc")).toBeNull();
    expect(parseTransactionEvidenceRef("transaction:1x")).toBeNull();
    expect(parseTransactionEvidenceRef(null)).toBeNull();
    expect(parseTransactionEvidenceRef(undefined)).toBeNull();
    expect(parseTransactionEvidenceRef("")).toBeNull();
  });
});

describe("runtime evidence integrity (API)", () => {
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

  const txn = (over: Record<string, unknown> = {}) => ({
    date: "2026-05-10",
    description: `Evidence Check ${Math.random().toString(36).slice(2)}`,
    amount: 12.34,
    category: "Other",
    type: "expense",
    ...over,
  });

  it("deleting a transaction clears its evidence refs and leaves valid refs unchanged", async () => {
    const { db, bonusMissionsTable, transactionsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    // Two real transactions, each referenced by a bonus mission.
    const resA = await post(txn());
    const resB = await post(txn());
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    const a = (await resA.json()) as { id: number };
    const b = (await resB.json()) as { id: number };

    const [bmA] = await db
      .insert(bonusMissionsTable)
      .values({
        userId: "evidence-test-a",
        date: "2001-01-01",
        missionType: "log_transaction",
        evidenceRef: transactionEvidenceRef(a.id),
      })
      .returning();
    const [bmB] = await db
      .insert(bonusMissionsTable)
      .values({
        userId: "evidence-test-b",
        date: "2001-01-02",
        missionType: "log_transaction",
        evidenceRef: transactionEvidenceRef(b.id),
      })
      .returning();

    // Both refs are valid: the validator reports no orphans among them.
    const before = await findOrphanedTransactionEvidenceRefs();
    expect(before.map((o) => o.bonusMissionId)).not.toContain(bmA.id);
    expect(before.map((o) => o.bonusMissionId)).not.toContain(bmB.id);

    // Delete transaction A via the API.
    const del = await fetch(`${baseUrl}/api/transactions/${a.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    // A's evidence ref was cleared, never left dangling and never remapped.
    const [bmAAfter] = await db
      .select()
      .from(bonusMissionsTable)
      .where(eq(bonusMissionsTable.id, bmA.id));
    expect(bmAAfter.evidenceRef).toBeNull();

    // B's valid reference remains unchanged.
    const [bmBAfter] = await db
      .select()
      .from(bonusMissionsTable)
      .where(eq(bonusMissionsTable.id, bmB.id));
    expect(bmBAfter.evidenceRef).toBe(transactionEvidenceRef(b.id));

    // Invariant holds: no bonus mission points at a deleted transaction.
    const after = await findOrphanedTransactionEvidenceRefs();
    expect(after.map((o) => o.bonusMissionId)).not.toContain(bmA.id);
    expect(after.map((o) => o.bonusMissionId)).not.toContain(bmB.id);

    // Cleanup so other suites see a pristine table.
    await db.delete(bonusMissionsTable).where(eq(bonusMissionsTable.id, bmA.id));
    await db.delete(bonusMissionsTable).where(eq(bonusMissionsTable.id, bmB.id));
    await db.delete(transactionsTable).where(eq(transactionsTable.id, b.id));
  });

  it("validator flags a ref pointing at a nonexistent transaction", async () => {
    const { db, bonusMissionsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const [bm] = await db
      .insert(bonusMissionsTable)
      .values({
        userId: "evidence-test-orphan",
        date: "2001-01-03",
        missionType: "log_transaction",
        evidenceRef: transactionEvidenceRef(99999999),
      })
      .returning();

    const orphans = await findOrphanedTransactionEvidenceRefs();
    expect(orphans.map((o) => o.bonusMissionId)).toContain(bm.id);

    await db.delete(bonusMissionsTable).where(eq(bonusMissionsTable.id, bm.id));
  });
});

describe("migration 0001 evidence remap (upgrade-style database)", () => {
  const UPGRADE_DB = "lucent_upgrade_evidence";
  let upgradeUrl: string;

  const psql = (url: string, sql: string): string =>
    execSync(`psql "$PSQL_URL" -v ON_ERROR_STOP=1 -t -A -c "$PSQL_SQL"`, {
      env: { ...process.env, PSQL_URL: url, PSQL_SQL: sql },
    })
      .toString()
      .trim();

  const psqlFile = (url: string, file: string): void => {
    execSync(`psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f "$PSQL_FILE"`, {
      env: { ...process.env, PSQL_URL: url, PSQL_FILE: file },
      stdio: "pipe",
    });
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const migrationsDir = path.join(repoRoot, "lib/db/drizzle");

  beforeAll(() => {
    const admin = process.env.DATABASE_URL;
    if (!admin) throw new Error("DATABASE_URL must be set");
    const url = new URL(admin);
    url.pathname = `/${UPGRADE_DB}`;
    upgradeUrl = url.toString();
    psql(admin, `DROP DATABASE IF EXISTS ${UPGRADE_DB}`);
    psql(admin, `CREATE DATABASE ${UPGRADE_DB}`);
  });

  afterAll(() => {
    const admin = process.env.DATABASE_URL;
    if (admin) psql(admin, `DROP DATABASE IF EXISTS ${UPGRADE_DB}`);
  });

  it("remaps duplicate evidence refs to the surviving transaction and orphans nothing", () => {
    // Baseline schema (a database that predates 0001).
    psqlFile(upgradeUrl, path.join(migrationsDir, "0000_smart_kitty_pryde.sql"));

    // Upgrade-style state: one fingerprint group with a survivor (101) and
    // two duplicates (102, 103), an unrelated transaction (200), and bonus
    // missions referencing the survivor, a duplicate, the unrelated row,
    // and a non-transaction evidence kind.
    psql(
      upgradeUrl,
      `INSERT INTO transactions (id, date, description, amount, category, type, fingerprint) VALUES
        (101, '2026-05-01', 'Dup Group', 10.00, 'Other', 'expense', 'fp-dup'),
        (102, '2026-05-01', 'Dup Group', 10.00, 'Other', 'expense', 'fp-dup'),
        (103, '2026-05-01', 'Dup Group', 10.00, 'Other', 'expense', 'fp-dup'),
        (200, '2026-05-02', 'Solo', 20.00, 'Other', 'expense', 'fp-solo')`
    );
    psql(
      upgradeUrl,
      `INSERT INTO bonus_missions (user_id, date, mission_type, evidence_ref) VALUES
        ('u1', '2026-05-01', 'log_transaction', 'transaction:101'),
        ('u2', '2026-05-01', 'log_transaction', 'transaction:103'),
        ('u3', '2026-05-01', 'log_transaction', 'transaction:200'),
        ('u4', '2026-05-01', 'pay_bill', 'bill:9')`
    );

    // Apply the amended 0001.
    psqlFile(upgradeUrl, path.join(migrationsDir, "0001_fast_supernaut.sql"));

    // Only the survivor remains in the duplicate group.
    expect(psql(upgradeUrl, "SELECT id FROM transactions WHERE fingerprint = 'fp-dup'")).toBe(
      "101"
    );

    // Survivor ref unchanged; duplicate ref remapped to the survivor;
    // unrelated transaction ref and non-transaction ref untouched.
    const refs = psql(
      upgradeUrl,
      "SELECT user_id || '=' || evidence_ref FROM bonus_missions ORDER BY user_id"
    ).split("\n");
    expect(refs).toEqual([
      "u1=transaction:101",
      "u2=transaction:101",
      "u3=transaction:200",
      "u4=bill:9",
    ]);

    // No bonus mission points at a deleted transaction.
    const orphanCount = psql(
      upgradeUrl,
      `SELECT count(*) FROM bonus_missions bm
       WHERE bm.evidence_ref LIKE 'transaction:%'
         AND NOT EXISTS (
           SELECT 1 FROM transactions t
           WHERE t.id::text = split_part(bm.evidence_ref, ':', 2)
         )`
    );
    expect(orphanCount).toBe("0");
  });
});

/**
 * Session A migration verification (read-only).
 *
 * Verifies the internal-user / ownership foundation added by migration
 * 0003_dapper_patch against the database at DATABASE_URL:
 *   - exactly one migration_pending legacy owner (fixed UUID, clerk, NULL subject)
 *   - zero NULL user_id rows in the four financial root tables (migrated snapshot)
 *   - gamification rows REMAIN under 'default-user' (their migration is a
 *     Session B hard gate; any row already carrying the owner UUID is a FAIL)
 *   - relationship integrity (account ownership, allocation owner equality)
 *   - known-anomaly detection: orphaned bonus-mission evidence refs (canonical
 *     "transaction:<id>" format) are DETECTED AND REPORTED as [ANOMALY],
 *     never repaired
 *
 * Exit behavior (documented contract):
 *   - exit 1 if any [FAIL] check fails
 *   - exit 0 with an explicit summary line when only known [ANOMALY] items
 *     are present (pre-existing corruption is reported, not silently fixed)
 *   - exit 0 clean otherwise
 * Never modifies data.
 *
 * Run: pnpm --filter @workspace/scripts run verify-session-a
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

const LEGACY_OWNER_UUID = "00000000-0000-4000-8000-000000000001";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let failures = 0;
let anomalies = 0;

function report(name: string, ok: boolean, detail: string): void {
  const tag = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`[${tag}] ${name}: ${detail}`);
}

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const res = await db.execute(query);
  return Number(Object.values(res.rows[0] ?? { n: NaN })[0]);
}

async function main(): Promise<void> {
  // --- Users ---------------------------------------------------------------
  const owners = await db.execute(
    sql`SELECT id, auth_provider, auth_provider_subject, status FROM users WHERE status = 'migration_pending'`,
  );
  report(
    "one migration_pending legacy owner",
    owners.rows.length === 1,
    `found ${owners.rows.length}`,
  );
  if (owners.rows.length === 1) {
    const o = owners.rows[0] as Record<string, unknown>;
    report("owner id is the documented fixed UUID", o.id === LEGACY_OWNER_UUID, String(o.id));
    report("owner id is a UUID", UUID_RE.test(String(o.id)), String(o.id));
    report("owner provider is clerk", o.auth_provider === "clerk", String(o.auth_provider));
    report(
      "owner provider subject is NULL",
      o.auth_provider_subject === null,
      String(o.auth_provider_subject),
    );
  }
  const dupSubjects = await scalar(
    sql`SELECT count(*) AS n FROM (
          SELECT auth_provider, auth_provider_subject FROM users
          WHERE auth_provider_subject IS NOT NULL
          GROUP BY auth_provider, auth_provider_subject HAVING count(*) > 1
        ) d`,
  );
  report("no duplicate provider-subject identities", dupSubjects === 0, `${dupSubjects} duplicates`);

  // --- Financial ownership (migrated snapshot must have zero NULLs) --------
  for (const table of ["accounts", "transactions", "budgets", "bills"] as const) {
    const total = await scalar(sql`SELECT count(*) AS n FROM ${sql.raw(table)}`);
    const nulls = await scalar(
      sql`SELECT count(*) AS n FROM ${sql.raw(table)} WHERE user_id IS NULL`,
    );
    report(`${table} NULL user_id`, nulls === 0, `${nulls} of ${total} rows unowned`);
  }

  // --- Gamification: MUST remain on 'default-user' during Session A ---------
  // The gamification ownership migration is deferred to Session B (it must
  // happen atomically with DEFAULT_USER removal and runtime propagation).
  // Session A therefore verifies the OPPOSITE of a backfill: no gamification
  // row may carry the legacy owner UUID, and existing rows stay visible to
  // the current runtime under 'default-user'.
  const gamTables = [
    "user_progress",
    "daily_missions",
    "bonus_missions",
    "earned_achievements",
    "xp_events",
  ] as const;
  const distinctIds = new Set<string>();
  for (const table of gamTables) {
    const total = await scalar(sql`SELECT count(*) AS n FROM ${sql.raw(table)}`);
    const defaults = await scalar(
      sql`SELECT count(*) AS n FROM ${sql.raw(table)} WHERE user_id = 'default-user'`,
    );
    const prematurelyMigrated = await scalar(
      sql`SELECT count(*) AS n FROM ${sql.raw(table)} WHERE user_id = ${LEGACY_OWNER_UUID}`,
    );
    report(
      `${table} rows prematurely migrated to the owner UUID`,
      prematurelyMigrated === 0,
      `${prematurelyMigrated} of ${total} rows (must be 0 until Session B)`,
    );
    console.log(`[INFO] ${table}: ${defaults} of ${total} rows under 'default-user'`);
    const ids = await db.execute(sql`SELECT DISTINCT user_id FROM ${sql.raw(table)}`);
    for (const r of ids.rows) distinctIds.add(String((r as Record<string, unknown>).user_id));
  }
  console.log(`[INFO] distinct gamification user_id values: ${JSON.stringify([...distinctIds])}`);

  // --- Relationship integrity ------------------------------------------------
  const txnAccountMismatch = await scalar(
    sql`SELECT count(*) AS n FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE t.user_id IS DISTINCT FROM a.user_id`,
  );
  report("transactions vs account owner mismatches", txnAccountMismatch === 0, `${txnAccountMismatch}`);

  const allocOwnerMismatch = await scalar(
    sql`SELECT count(*) AS n FROM transaction_allocations al
        JOIN transactions s ON s.id = al.source_transaction_id
        JOIN transactions t ON t.id = al.target_transaction_id
        WHERE s.user_id IS DISTINCT FROM t.user_id`,
  );
  report("allocation source/target owner mismatches", allocOwnerMismatch === 0, `${allocOwnerMismatch}`);

  const allocNullSource = await scalar(
    sql`SELECT count(*) AS n FROM transaction_allocations al
        JOIN transactions s ON s.id = al.source_transaction_id
        WHERE s.user_id IS NULL`,
  );
  report("allocations with NULL-owned source", allocNullSource === 0, `${allocNullSource}`);

  const allocNullTarget = await scalar(
    sql`SELECT count(*) AS n FROM transaction_allocations al
        JOIN transactions t ON t.id = al.target_transaction_id
        WHERE t.user_id IS NULL`,
  );
  report("allocations with NULL-owned target", allocNullTarget === 0, `${allocNullTarget}`);

  // --- Known-anomaly detection (reported, never repaired) --------------------
  // Evidence refs use the canonical "transaction:<id>" format owned by
  // api-server/src/lib/evidence.ts; the SQL below mirrors its strict parser
  // (prefix + digits only) without rewriting the format.
  //
  // Orphaned refs (pointing at a transaction that no longer exists) are
  // reported as [ANOMALY], NOT as failures: pre-existing data corruption is
  // Session A's to detect and report, never to silently mutate. Repairing an
  // orphan is a separate, explicitly-approved procedure (the runtime rule is
  // documented in api-server: DELETE /transactions/:id clears — nulls, never
  // remaps — evidence refs; a manual repair should do the same, with sign-off).
  const orphanRows = await db.execute(
    sql`SELECT bm.id, bm.user_id, bm.evidence_ref FROM bonus_missions bm
        LEFT JOIN transactions t
          ON bm.evidence_ref ~ '^transaction:[0-9]+$'
         AND t.id = substring(bm.evidence_ref FROM 13)::int
        WHERE bm.evidence_ref LIKE 'transaction:%' AND t.id IS NULL
        ORDER BY bm.id`,
  );
  for (const r of orphanRows.rows as Record<string, unknown>[]) {
    anomalies++;
    console.log(
      `[ANOMALY] bonus_missions id=${r.id} has evidence_ref '${r.evidence_ref}' pointing at a transaction that does not exist (pre-existing orphan; detect-and-report only — no automatic repair)`,
    );
  }
  if (orphanRows.rows.length === 0) {
    console.log("[INFO] no orphaned bonus-mission evidence refs detected");
  }

  if (failures === 0 && anomalies === 0) {
    console.log("\nSESSION A VERIFICATION: ALL CHECKS PASSED");
  } else if (failures === 0) {
    console.log(
      `\nSESSION A VERIFICATION: ALL CHECKS PASSED WITH ${anomalies} KNOWN ANOMALY(IES) REPORTED (exit 0 — anomalies are pre-existing, documented, and require a separate approved repair)`,
    );
  } else {
    console.log(`\nSESSION A VERIFICATION: ${failures} CHECK(S) FAILED`);
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error("verification error:", err);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());

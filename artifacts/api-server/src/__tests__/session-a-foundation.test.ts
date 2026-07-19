import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ALL_TEST_USERS, TEST_USER, USER_A, USER_B, LEGACY_OWNER_UUID } from "./fixtures/users";

/**
 * Session A foundation tests: users table, nullable ownership columns,
 * migration backfill, and preserved global constraints.
 *
 * These tests run against the scratch vitest database, which is built from
 * the checked-in migrations (0000–0003) and seeded with the deterministic
 * test-user fixtures by global-setup.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rows(query: ReturnType<typeof sql>) {
  return (await db.execute(query)).rows as Record<string, unknown>[];
}

/**
 * Drizzle wraps database errors ("Failed query: ...") with the real Postgres
 * error on `cause`. This helper asserts the underlying constraint violation.
 */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected query to be rejected").not.toBeNull();
  const err = caught as Error & { cause?: Error };
  const combined = `${err.message} ${err.cause?.message ?? ""}`;
  expect(combined).toMatch(pattern);
}

describe("users table", () => {
  it("contains the seeded test fixtures with fixed UUID ids", async () => {
    for (const u of ALL_TEST_USERS) {
      const r = await rows(sql`SELECT * FROM users WHERE id = ${u.id}`);
      expect(r).toHaveLength(1);
      expect(r[0].auth_provider).toBe("clerk");
      expect(r[0].auth_provider_subject).toBe(u.authProviderSubject);
      expect(r[0].status).toBe("active");
      expect(UUID_RE.test(String(r[0].id))).toBe(true);
    }
    expect(new Set(ALL_TEST_USERS.map((u) => u.id)).size).toBe(3);
  });

  it("generates a uuid id by default", async () => {
    const r = await rows(
      sql`INSERT INTO users (auth_provider, auth_provider_subject) VALUES ('clerk', 'test-sub-generated-id') RETURNING id, status`,
    );
    expect(UUID_RE.test(String(r[0].id))).toBe(true);
    expect(r[0].status).toBe("active");
    await db.execute(sql`DELETE FROM users WHERE id = ${r[0].id}`);
  });

  it("rejects duplicate (auth_provider, auth_provider_subject) identities", async () => {
    await expectDbError(
      db.execute(
        sql`INSERT INTO users (auth_provider, auth_provider_subject) VALUES ('clerk', ${TEST_USER.authProviderSubject})`,
      ),
      /users_provider_subject_unique|duplicate key/,
    );
  });

  it("allows multiple rows with NULL auth_provider_subject", async () => {
    // Postgres UNIQUE treats NULLs as distinct — required so multiple
    // migration_pending placeholders could theoretically coexist.
    const r = await rows(
      sql`INSERT INTO users (auth_provider, auth_provider_subject, status) VALUES ('clerk', NULL, 'migration_pending') RETURNING id`,
    );
    await db.execute(sql`DELETE FROM users WHERE id = ${r[0].id}`);
  });

  it("rejects invalid status values", async () => {
    await expectDbError(
      db.execute(
        sql`INSERT INTO users (auth_provider, auth_provider_subject, status) VALUES ('clerk', 'test-sub-bad-status', 'banana')`,
      ),
      /users_status_check/,
    );
  });

  it("has exactly one migration_pending legacy owner with the documented UUID", async () => {
    const r = await rows(sql`SELECT id, auth_provider, auth_provider_subject FROM users WHERE status = 'migration_pending'`);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(LEGACY_OWNER_UUID);
    expect(r[0].auth_provider).toBe("clerk");
    expect(r[0].auth_provider_subject).toBeNull();
  });
});

describe("ownership columns", () => {
  const OWNED_TABLES = ["accounts", "transactions", "budgets", "bills"] as const;

  it("exist as nullable uuid columns with no default on all four financial tables", async () => {
    for (const table of OWNED_TABLES) {
      const r = await rows(
        sql`SELECT is_nullable, data_type, column_default FROM information_schema.columns
            WHERE table_name = ${table} AND column_name = 'user_id'`,
      );
      expect(r, table).toHaveLength(1);
      expect(r[0].is_nullable, table).toBe("YES");
      expect(r[0].data_type, table).toBe("uuid");
      expect(r[0].column_default, table).toBeNull();
    }
  });

  it("accept NULL user_id (Session A writers do not set ownership yet)", async () => {
    const acct = await rows(
      sql`INSERT INTO accounts (name, type, balance, institution) VALUES ('SessA Null Owner', 'checking', '0', 'Test Bank') RETURNING id, user_id`,
    );
    expect(acct[0].user_id).toBeNull();
    await db.execute(sql`DELETE FROM accounts WHERE id = ${acct[0].id}`);
  });

  it("reject a user_id that does not reference an existing user", async () => {
    await expectDbError(
      db.execute(
        sql`INSERT INTO accounts (name, type, balance, institution, user_id) VALUES ('SessA Bad FK', 'checking', '0', 'Test Bank', '00000000-0000-4000-8000-00000000dead')`,
      ),
      /accounts_user_id_users_id_fk|foreign key/,
    );
  });

  it("RESTRICT: cannot delete a user who still owns rows", async () => {
    const acct = await rows(
      sql`INSERT INTO accounts (name, type, balance, institution, user_id) VALUES ('SessA Restrict', 'checking', '0', 'Test Bank', ${USER_A.id}) RETURNING id`,
    );
    await expectDbError(
      db.execute(sql`DELETE FROM users WHERE id = ${USER_A.id}`),
      /restrict|violates foreign key/i,
    );
    await db.execute(sql`DELETE FROM accounts WHERE id = ${acct[0].id}`);
  });

  it("expected ownership indexes exist", async () => {
    const r = await rows(
      sql`SELECT indexname FROM pg_indexes WHERE indexname IN
          ('accounts_user_id_idx','transactions_user_id_date_idx','budgets_user_id_year_month_idx','bills_user_id_due_date_idx')`,
    );
    expect(r.map((x) => x.indexname).sort()).toEqual([
      "accounts_user_id_idx",
      "bills_user_id_due_date_idx",
      "budgets_user_id_year_month_idx",
      "transactions_user_id_date_idx",
    ]);
  });
});

describe("preserved Session A invariants (Session B hard gates untouched)", () => {
  it("transactions fingerprint uniqueness is still GLOBAL (not per-user)", async () => {
    const idx = await rows(
      sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'transactions_fingerprint_unique'`,
    );
    expect(idx).toHaveLength(1);
    const def = String(idx[0].indexdef);
    expect(def).toContain("UNIQUE");
    expect(def).not.toContain("user_id");

    // Behavioral proof: same fingerprint under two DIFFERENT owners still collides.
    const acct = await rows(
      sql`INSERT INTO accounts (name, type, balance, institution) VALUES ('SessA FP', 'checking', '0', 'Test Bank') RETURNING id`,
    );
    const accountId = acct[0].id;
    const fp = "sessa-global-fp-proof";
    const t1 = await rows(
      sql`INSERT INTO transactions (description, amount, type, category, date, account_id, fingerprint, user_id)
          VALUES ('fp1', '1.00', 'expense', 'Other', '2026-07-01', ${accountId}, ${fp}, ${USER_A.id}) RETURNING id`,
    );
    await expectDbError(
      db.execute(
        sql`INSERT INTO transactions (description, amount, type, category, date, account_id, fingerprint, user_id)
            VALUES ('fp2', '1.00', 'expense', 'Other', '2026-07-01', ${accountId}, ${fp}, ${USER_B.id})`,
      ),
      /transactions_fingerprint_unique|duplicate key/,
    );
    await db.execute(sql`DELETE FROM transactions WHERE id = ${t1[0].id}`);
    await db.execute(sql`DELETE FROM accounts WHERE id = ${accountId}`);
  });

  it("gamification user_id columns are still text with DEFAULT 'default-user'", async () => {
    for (const table of ["user_progress", "daily_missions", "bonus_missions", "earned_achievements", "xp_events"] as const) {
      const r = await rows(
        sql`SELECT data_type, column_default FROM information_schema.columns
            WHERE table_name = ${table} AND column_name = 'user_id'`,
      );
      expect(r, table).toHaveLength(1);
      expect(r[0].data_type, table).toBe("text");
      expect(String(r[0].column_default), table).toContain("default-user");
    }
  });

  it("xp_events idempotency key UNIQUE(user_id, event_type, source_id) is intact", async () => {
    const r = await rows(
      sql`SELECT 1 FROM pg_indexes WHERE tablename = 'xp_events' AND indexdef LIKE '%UNIQUE%'
          AND indexdef LIKE '%user_id%' AND indexdef LIKE '%event_type%' AND indexdef LIKE '%source_id%'`,
    );
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
});

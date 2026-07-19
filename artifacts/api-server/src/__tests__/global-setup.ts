import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALL_TEST_USERS } from "./fixtures/users";

const TEST_DB = "lucent_vitest";

/**
 * Creates a fresh scratch database, applies ALL checked-in drizzle
 * migrations to it, seeds the deterministic test-user fixtures, then points
 * DATABASE_URL at it for all test workers. Tests never touch the
 * development database.
 */
export default async function setup(): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL must be set to run tests");

  const testUrl = new URL(base);
  testUrl.pathname = `/${TEST_DB}`;

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

  execSync(
    `psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS ${TEST_DB};' -c 'CREATE DATABASE ${TEST_DB};'`,
    { stdio: "inherit", env: { ...process.env, ADMIN_URL: base } }
  );
  execSync("pnpm --filter @workspace/db run migrate", {
    stdio: "inherit",
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
  });

  // Seed deterministic test users (fixed UUIDs, fake provider subjects).
  // The SQL is written to a temp file and executed with `psql -f` — nothing
  // is interpolated into a shell command, and every value is escaped as a
  // proper SQL string literal (single quotes doubled). Idempotent by
  // construction: the scratch DB is recreated above.
  const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`;
  const seedSql = ALL_TEST_USERS.map(
    (u) =>
      `INSERT INTO users (id, auth_provider, auth_provider_subject, email, status) ` +
      `VALUES (${lit(u.id)}, ${lit(u.authProvider)}, ${lit(u.authProviderSubject)}, ${lit(u.email)}, ${lit(u.status)});`
  ).join("\n");
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "lucent-seed-"));
  const seedFile = path.join(tmpDir, "seed-users.sql");
  try {
    writeFileSync(seedFile, seedSql, "utf8");
    execSync(`psql "$TEST_URL" -v ON_ERROR_STOP=1 -f "$SEED_FILE"`, {
      stdio: "inherit",
      env: { ...process.env, TEST_URL: testUrl.toString(), SEED_FILE: seedFile },
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  process.env.DATABASE_URL = testUrl.toString();
}

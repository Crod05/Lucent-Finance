import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TEST_DB = "lucent_vitest";

/**
 * Creates a fresh scratch database and applies the checked-in drizzle
 * migrations (0000 + 0001) to it, then points DATABASE_URL at it for all
 * test workers. Tests never touch the development database.
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

  process.env.DATABASE_URL = testUrl.toString();
}

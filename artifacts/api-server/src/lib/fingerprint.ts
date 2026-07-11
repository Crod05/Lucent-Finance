import { createHash } from "node:crypto";

/**
 * Deterministic dedup fingerprint over (date, normalized description, amount,
 * type, accountId). Must stay in sync with the SQL backfill expression used
 * when the column was added. Enforced by the partial unique index
 * `transactions_fingerprint_unique` (non-null fingerprints only), so two rows
 * with the same fingerprint can never coexist — even under concurrent inserts.
 */
export function computeFingerprint(input: {
  date: string;
  description: string;
  amount: number | string;
  type: string;
  accountId: number | null | undefined;
}): string {
  const desc = input.description.trim().toLowerCase().replace(/\s+/g, " ");
  const amt = Number(input.amount).toFixed(2);
  const account = input.accountId == null ? "" : String(input.accountId);
  return createHash("sha256")
    .update(`${input.date}|${desc}|${amt}|${input.type}|${account}`)
    .digest("hex");
}

/** True when a Postgres error represents a unique-constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  return typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "23505";
}

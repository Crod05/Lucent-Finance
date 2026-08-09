import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import type { VerifiedProviderIdentity } from "./provider";
import type { AuthContext } from "./context";

/**
 * Internal Lucent user resolution (Session B-Alpha, sections 6–10).
 *
 * Converts a VERIFIED external provider identity into the internal
 * `users.id` UUID that becomes `authContext.userId`. The provider subject
 * (Clerk user id) is used for identity resolution ONLY — never as an
 * ownership foreign key.
 */

/** The fixed legacy owner row created by migration 0003 (Session A). */
export const LEGACY_OWNER_UUID = "00000000-0000-4000-8000-000000000001";

/** Env var naming the ONLY Clerk subject allowed to claim the legacy portfolio. */
export const LEGACY_OWNER_SUBJECT_ENV = "LUCENT_LEGACY_OWNER_CLERK_SUBJECT";

export type ResolveFailureCode =
  /** users.status = 'disabled' → final protected behavior 403 */
  | "account_disabled"
  /** users.status = 'migration_pending' — not an ordinary active account */
  | "account_migration_pending"
  /** designated legacy subject, but the claim could not be completed */
  | "legacy_claim_failed";

export type ResolveResult =
  | { ok: true; context: AuthContext }
  | { ok: false; code: ResolveFailureCode };

function contextFor(user: User, identity: VerifiedProviderIdentity): AuthContext {
  return {
    userId: user.id,
    authProvider: "clerk",
    providerSubject: identity.subject,
    sessionId: identity.sessionId,
  };
}

async function findBySubject(identity: VerifiedProviderIdentity): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.authProvider, identity.provider),
        eq(usersTable.authProviderSubject, identity.subject),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function statusResult(user: User, identity: VerifiedProviderIdentity): ResolveResult {
  switch (user.status) {
    case "active":
      return { ok: true, context: contextFor(user, identity) };
    case "disabled":
      return { ok: false, code: "account_disabled" };
    case "migration_pending":
      // Must NOT behave like an ordinary active account. The legacy owner
      // becomes active only through the controlled claim below.
      return { ok: false, code: "account_migration_pending" };
    default:
      // The DB CHECK constraint makes this unreachable; fail closed anyway.
      return { ok: false, code: "account_disabled" };
  }
}

/**
 * Controlled legacy-owner claim (section 9). Conditional and race-safe:
 * succeeds ONLY when the fixed legacy row is still exactly in its Session A
 * state (`migration_pending`, subject NULL) — exactly one affected row.
 *
 * Never: "first authenticated user claims the portfolio", email matching,
 * or claiming by any subject other than the configured one.
 */
export async function claimLegacyOwner(subject: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE users
    SET auth_provider_subject = ${subject},
        status = 'active',
        updated_at = now()
    WHERE id = ${LEGACY_OWNER_UUID}
      AND status = 'migration_pending'
      AND auth_provider_subject IS NULL
  `);
  return result.rowCount === 1;
}

/**
 * Race-safe new-user provisioning (section 8). The DB unique constraint on
 * (auth_provider, auth_provider_subject) is the final concurrency
 * authority: INSERT ... ON CONFLICT DO NOTHING, then deterministically
 * reread the winning row. Email is NEVER a provisioning key, and no legacy
 * data is ever attached to a new user.
 */
async function provisionUser(identity: VerifiedProviderIdentity): Promise<User> {
  const inserted = await db
    .insert(usersTable)
    .values({
      authProvider: identity.provider,
      authProviderSubject: identity.subject,
      status: "active",
    })
    .onConflictDoNothing({
      target: [usersTable.authProvider, usersTable.authProviderSubject],
    })
    .returning();
  if (inserted[0]) return inserted[0];
  // Lost the race — the concurrent winner's row is authoritative.
  const existing = await findBySubject(identity);
  if (!existing) {
    throw new Error("user provisioning conflict but no existing row found on reread");
  }
  return existing;
}

/**
 * Resolve a verified provider identity to an internal Lucent user.
 *
 * `legacyOwnerSubject` is the value of LUCENT_LEGACY_OWNER_CLERK_SUBJECT
 * (or undefined when the env var is absent — in which case the legacy
 * portfolio is simply unclaimable; authentication itself stays functional
 * for all other users).
 */
export async function resolveLucentUser(
  identity: VerifiedProviderIdentity,
  legacyOwnerSubject: string | undefined,
): Promise<ResolveResult> {
  const existing = await findBySubject(identity);
  if (existing) return statusResult(existing, identity);

  const isDesignatedLegacySubject =
    legacyOwnerSubject !== undefined &&
    legacyOwnerSubject !== "" &&
    identity.subject === legacyOwnerSubject;

  if (isDesignatedLegacySubject) {
    const claimed = await claimLegacyOwner(identity.subject);
    if (!claimed) {
      // A concurrent claim by the SAME subject may have just won; reread.
      const after = await findBySubject(identity);
      if (after) return statusResult(after, identity);
      // Legacy row is not in its expected claimable state and no row exists
      // for this subject. Fail closed — never silently provision a fresh
      // empty account for the designated legacy owner.
      return { ok: false, code: "legacy_claim_failed" };
    }
    const claimedRow = await findBySubject(identity);
    if (!claimedRow) {
      return { ok: false, code: "legacy_claim_failed" };
    }
    return statusResult(claimedRow, identity);
  }

  const user = await provisionUser(identity);
  return statusResult(user, identity);
}

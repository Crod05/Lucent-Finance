import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { Request, Response } from "express";
import { TestAuthProviderAdapter } from "../lib/auth/test-adapter";
import { resolveLucentUser, claimLegacyOwner, LEGACY_OWNER_UUID } from "../lib/auth/resolver";
import { requireUser } from "../lib/auth/middleware";
import { getAuthContext, tryGetAuthContext } from "../lib/auth/context";
import type { VerifiedProviderIdentity } from "../lib/auth/provider";
import { USER_A, USER_B } from "./fixtures/users";

/**
 * Session B-Alpha authentication-foundation tests.
 *
 * These tests exercise the REAL resolver and middleware against the scratch
 * vitest database. The TestAuthProviderAdapter replaces only EXTERNAL
 * identity verification ("this request was authenticated as subject X");
 * it never bypasses Lucent authorization. No Clerk network calls occur
 * anywhere in this file.
 */

const LEGACY_SUBJECT = "clerk-legacy-owner-subject";

function identityFor(subject: string): VerifiedProviderIdentity {
  return { provider: "clerk", subject, sessionId: "test-session" };
}

/** Restore the legacy owner row to its exact Session A state. */
async function resetLegacyRow(): Promise<void> {
  await db.execute(sql`
    UPDATE users
    SET auth_provider_subject = NULL, status = 'migration_pending', updated_at = now()
    WHERE id = ${LEGACY_OWNER_UUID}
  `);
}

function mockReqRes(opts: { method?: string; path?: string } = {}) {
  const req = {
    method: opts.method ?? "POST",
    path: opts.path ?? "/transactions",
  } as unknown as Request;
  let statusCode: number | null = null;
  let body: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;
  return {
    req,
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

async function runMiddleware(
  adapter: TestAuthProviderAdapter,
  legacyOwnerSubject: string | undefined,
  reqRes: ReturnType<typeof mockReqRes>,
): Promise<{ nextCalled: boolean; nextErr: unknown }> {
  const mw = requireUser(adapter, { legacyOwnerSubject });
  let nextCalled = false;
  let nextErr: unknown = null;
  await mw(reqRes.req, reqRes.res, (err?: unknown) => {
    nextCalled = true;
    nextErr = err ?? null;
  });
  return { nextCalled, nextErr };
}

describe("test auth adapter", () => {
  it("can represent authenticated USER_A", async () => {
    const adapter = new TestAuthProviderAdapter();
    adapter.actAs(USER_A.authProviderSubject);
    const identity = await adapter.verifyRequestIdentity({} as Request);
    expect(identity).not.toBeNull();
    expect(identity!.subject).toBe(USER_A.authProviderSubject);
    expect(identity!.provider).toBe("clerk");
  });

  it("can represent authenticated USER_B", async () => {
    const adapter = new TestAuthProviderAdapter();
    adapter.actAs(USER_B.authProviderSubject);
    const identity = await adapter.verifyRequestIdentity({} as Request);
    expect(identity!.subject).toBe(USER_B.authProviderSubject);
  });

  it("can represent an unauthenticated request", async () => {
    const adapter = new TestAuthProviderAdapter();
    adapter.actAsUnauthenticated();
    expect(await adapter.verifyRequestIdentity({} as Request)).toBeNull();
  });
});

describe("internal user resolver", () => {
  it("resolves an existing active user to its internal Lucent UUID", async () => {
    const result = await resolveLucentUser(identityFor(USER_A.authProviderSubject), undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.userId).toBe(USER_A.id);
      expect(result.context.providerSubject).toBe(USER_A.authProviderSubject);
      expect(result.context.authProvider).toBe("clerk");
    }
  });

  it("rejects a disabled internal user", async () => {
    const subject = "test-sub-disabled-user";
    await db.execute(sql`
      INSERT INTO users (auth_provider, auth_provider_subject, status)
      VALUES ('clerk', ${subject}, 'disabled')
      ON CONFLICT (auth_provider, auth_provider_subject) DO UPDATE SET status = 'disabled'
    `);
    try {
      const result = await resolveLucentUser(identityFor(subject), undefined);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("account_disabled");
    } finally {
      await db.execute(
        sql`DELETE FROM users WHERE auth_provider = 'clerk' AND auth_provider_subject = ${subject}`,
      );
    }
  });

  it("does not treat a migration_pending user as an ordinary active user", async () => {
    const subject = "test-sub-pending-user";
    await db.execute(sql`
      INSERT INTO users (auth_provider, auth_provider_subject, status)
      VALUES ('clerk', ${subject}, 'migration_pending')
    `);
    try {
      const result = await resolveLucentUser(identityFor(subject), undefined);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("account_migration_pending");
    } finally {
      await db.execute(
        sql`DELETE FROM users WHERE auth_provider = 'clerk' AND auth_provider_subject = ${subject}`,
      );
    }
  });

  it("provisions a brand-new subject as a fresh active user with no legacy data attached", async () => {
    const subject = "test-sub-brand-new-user";
    try {
      const result = await resolveLucentUser(identityFor(subject), undefined);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.context.userId).not.toBe(LEGACY_OWNER_UUID);
        const owned = await db.execute(sql`
          SELECT (SELECT count(*) FROM accounts WHERE user_id = ${result.context.userId})::int
               + (SELECT count(*) FROM transactions WHERE user_id = ${result.context.userId})::int
               + (SELECT count(*) FROM budgets WHERE user_id = ${result.context.userId})::int
               + (SELECT count(*) FROM bills WHERE user_id = ${result.context.userId})::int AS n
        `);
        expect(Number((owned.rows[0] as { n: number }).n)).toBe(0);
      }
    } finally {
      await db.execute(
        sql`DELETE FROM users WHERE auth_provider = 'clerk' AND auth_provider_subject = ${subject}`,
      );
    }
  });

  it("handles a duplicate first-request provisioning race deterministically", async () => {
    const subject = "test-sub-race-user";
    try {
      const [r1, r2] = await Promise.all([
        resolveLucentUser(identityFor(subject), undefined),
        resolveLucentUser(identityFor(subject), undefined),
      ]);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r1.context.userId).toBe(r2.context.userId);
      }
      const count = await db.execute(
        sql`SELECT count(*)::int AS n FROM users WHERE auth_provider = 'clerk' AND auth_provider_subject = ${subject}`,
      );
      expect(Number((count.rows[0] as { n: number }).n)).toBe(1);
    } finally {
      await db.execute(
        sql`DELETE FROM users WHERE auth_provider = 'clerk' AND auth_provider_subject = ${subject}`,
      );
    }
  });
});

describe("controlled legacy owner claim", () => {
  beforeEach(async () => {
    await resetLegacyRow();
  });

  it("the configured Clerk subject can claim the fixed legacy row (exactly once)", async () => {
    const result = await resolveLucentUser(identityFor(LEGACY_SUBJECT), LEGACY_SUBJECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.userId).toBe(LEGACY_OWNER_UUID);
    }
    const row = await db.execute(
      sql`SELECT status, auth_provider_subject FROM users WHERE id = ${LEGACY_OWNER_UUID}`,
    );
    const r = row.rows[0] as { status: string; auth_provider_subject: string };
    expect(r.status).toBe("active");
    expect(r.auth_provider_subject).toBe(LEGACY_SUBJECT);
    await resetLegacyRow();
  });

  it("a claim against an already-claimed row affects zero rows", async () => {
    expect(await claimLegacyOwner(LEGACY_SUBJECT)).toBe(true);
    expect(await claimLegacyOwner("some-other-subject")).toBe(false);
    await resetLegacyRow();
  });

  it("a DIFFERENT Clerk subject cannot claim the legacy row — it gets a fresh empty user", async () => {
    const other = "test-sub-not-the-legacy-owner";
    try {
      const result = await resolveLucentUser(identityFor(other), LEGACY_SUBJECT);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.context.userId).not.toBe(LEGACY_OWNER_UUID);
      }
      const legacy = await db.execute(
        sql`SELECT status, auth_provider_subject FROM users WHERE id = ${LEGACY_OWNER_UUID}`,
      );
      const r = legacy.rows[0] as { status: string; auth_provider_subject: string | null };
      expect(r.status).toBe("migration_pending");
      expect(r.auth_provider_subject).toBeNull();
    } finally {
      await db.execute(
        sql`DELETE FROM users WHERE auth_provider = 'clerk' AND auth_provider_subject = ${other}`,
      );
    }
  });

  it("a MISSING legacy claim env var makes the legacy portfolio unclaimable", async () => {
    // The designated subject authenticates, but no env var is configured:
    // the resolver must NOT claim the legacy row. The subject is provisioned
    // as an ordinary fresh user instead; the legacy row stays untouched.
    try {
      const result = await resolveLucentUser(identityFor(LEGACY_SUBJECT), undefined);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.context.userId).not.toBe(LEGACY_OWNER_UUID);
      }
      const legacy = await db.execute(
        sql`SELECT status, auth_provider_subject FROM users WHERE id = ${LEGACY_OWNER_UUID}`,
      );
      const r = legacy.rows[0] as { status: string; auth_provider_subject: string | null };
      expect(r.status).toBe("migration_pending");
      expect(r.auth_provider_subject).toBeNull();
    } finally {
      await db.execute(sql`
        DELETE FROM users
        WHERE auth_provider = 'clerk' AND auth_provider_subject = ${LEGACY_SUBJECT}
          AND id <> ${LEGACY_OWNER_UUID}
      `);
    }
  });

  it("an EMPTY legacy claim env var also prevents claiming", async () => {
    try {
      const result = await resolveLucentUser(identityFor(LEGACY_SUBJECT), "");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.userId).not.toBe(LEGACY_OWNER_UUID);
    } finally {
      await db.execute(sql`
        DELETE FROM users
        WHERE auth_provider = 'clerk' AND auth_provider_subject = ${LEGACY_SUBJECT}
          AND id <> ${LEGACY_OWNER_UUID}
      `);
    }
  });
});

describe("requireUser middleware (401/403 error contract)", () => {
  it("returns 401 for an unauthenticated request without leaking detail", async () => {
    const adapter = new TestAuthProviderAdapter();
    adapter.actAsUnauthenticated();
    const rr = mockReqRes();
    const { nextCalled } = await runMiddleware(adapter, undefined, rr);
    expect(nextCalled).toBe(false);
    expect(rr.statusCode).toBe(401);
    expect(rr.body).toEqual({ error: "Authentication required" });
  });

  it("returns 403 for a disabled account", async () => {
    const subject = "test-sub-mw-disabled";
    await db.execute(sql`
      INSERT INTO users (auth_provider, auth_provider_subject, status)
      VALUES ('clerk', ${subject}, 'disabled')
    `);
    try {
      const adapter = new TestAuthProviderAdapter();
      adapter.actAs(subject);
      const rr = mockReqRes();
      const { nextCalled } = await runMiddleware(adapter, undefined, rr);
      expect(nextCalled).toBe(false);
      expect(rr.statusCode).toBe(403);
      expect(rr.body).toEqual({ error: "Account unavailable" });
    } finally {
      await db.execute(
        sql`DELETE FROM users WHERE auth_provider = 'clerk' AND auth_provider_subject = ${subject}`,
      );
    }
  });

  it("attaches AuthContext and calls next() for an active user", async () => {
    const adapter = new TestAuthProviderAdapter();
    adapter.actAs(USER_A.authProviderSubject);
    const rr = mockReqRes();
    const { nextCalled, nextErr } = await runMiddleware(adapter, undefined, rr);
    expect(nextCalled).toBe(true);
    expect(nextErr).toBeNull();
    const ctx = getAuthContext(rr.req);
    expect(ctx.userId).toBe(USER_A.id);
    expect(ctx.providerSubject).toBe(USER_A.authProviderSubject);
    expect(ctx.sessionId).toBe("test-session");
  });

  it("lets GET /healthz through without authentication (the only public exception)", async () => {
    const adapter = new TestAuthProviderAdapter();
    adapter.actAsUnauthenticated();
    const rr = mockReqRes({ method: "GET", path: "/healthz" });
    const { nextCalled } = await runMiddleware(adapter, undefined, rr);
    expect(nextCalled).toBe(true);
    expect(rr.statusCode).toBeNull();
    expect(tryGetAuthContext(rr.req)).toBeNull();
  });

  it("getAuthContext fails loudly when middleware composition is missing", () => {
    const rr = mockReqRes();
    expect(() => getAuthContext(rr.req)).toThrow(/no AuthContext is attached/);
  });
});

describe("provider isolation and no network calls", () => {
  it("no protected business-logic module imports Clerk", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const forbidden: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__") continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        // The ONLY file allowed to import @clerk/express:
        if (full.endsWith(`auth${path.sep}clerk-adapter.ts`)) continue;
        if (readFileSync(full, "utf8").includes("@clerk/express")) forbidden.push(full);
      }
    };
    walk(srcDir);
    expect(forbidden).toEqual([]);
  });

  it("requireAuth() from Clerk is not used anywhere", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const adapterPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../lib/auth/clerk-adapter.ts",
    );
    const src = readFileSync(adapterPath, "utf8");
    // Assert on actual code usage: requireAuth must never be imported from
    // @clerk/express (prose mentions in comments are fine).
    const importLines = src
      .split("\n")
      .filter((l) => l.includes("@clerk/express") && l.includes("import"));
    expect(importLines.length).toBeGreaterThanOrEqual(1);
    for (const line of importLines) {
      expect(line).not.toContain("requireAuth");
    }
    expect(src).toContain("clerkMiddleware");
    expect(src).toContain("getAuth");
  });
});

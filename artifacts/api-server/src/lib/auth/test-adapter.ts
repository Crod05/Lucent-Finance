import type { Request } from "express";
import type { AuthProviderAdapter, VerifiedProviderIdentity } from "./provider";

/**
 * Deterministic test authentication adapter (Session B-Alpha, section 11).
 *
 * Replaces EXTERNAL identity verification only — it answers "this request
 * was authenticated as subject X". It must NEVER bypass Lucent
 * authorization: the internal user resolver, status rules, and (future)
 * ownership filters always execute for real.
 *
 * No Clerk network calls are ever made by this adapter.
 */
export class TestAuthProviderAdapter implements AuthProviderAdapter {
  private principal: VerifiedProviderIdentity | null = null;

  /** Represent an authenticated request for the given provider subject. */
  actAs(subject: string, sessionId: string | null = "test-session"): void {
    this.principal = { provider: "clerk", subject, sessionId };
  }

  /** Represent an unauthenticated request. */
  actAsUnauthenticated(): void {
    this.principal = null;
  }

  async verifyRequestIdentity(_req: Request): Promise<VerifiedProviderIdentity | null> {
    return this.principal;
  }
}

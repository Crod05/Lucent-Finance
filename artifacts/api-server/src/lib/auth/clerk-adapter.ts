import type { Request, RequestHandler } from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import type { AuthProviderAdapter, VerifiedProviderIdentity } from "./provider";

/**
 * Clerk implementation of the provider boundary (Session B-Alpha).
 *
 * This is the ONLY file in the application allowed to import "@clerk/express".
 * It intentionally uses clerkMiddleware() + getAuth() — NOT requireAuth(),
 * which is deprecated for this API architecture.
 *
 * B-Beta activation point: `clerkVerificationMiddleware()` must be mounted in
 * createApp (app.ts) BEFORE the Lucent auth middleware so that getAuth(req)
 * has verified request state to read. It is NOT mounted in B-Alpha — the
 * current unauthenticated frontend keeps working unchanged.
 */

/** The Clerk verification layer that B-Beta will mount via app.use(...). */
export function clerkVerificationMiddleware(): RequestHandler {
  return clerkMiddleware();
}

export class ClerkAuthProviderAdapter implements AuthProviderAdapter {
  async verifyRequestIdentity(req: Request): Promise<VerifiedProviderIdentity | null> {
    const auth = getAuth(req);
    if (!auth?.userId) return null;
    return {
      provider: "clerk",
      subject: auth.userId,
      sessionId: auth.sessionId ?? null,
    };
  }
}

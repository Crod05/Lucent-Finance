import type { Request } from "express";

/**
 * AuthContext — the ONE application-owned authentication context (Session
 * B-Alpha, section 3 of the auth plan).
 *
 * - `userId` is the internal Lucent `users.id` UUID and is the ONLY
 *   authoritative ownership identity.
 * - `providerSubject` is the external provider's user id (Clerk userId). It
 *   is used for identity resolution only and must NEVER be used as an
 *   ownership foreign key.
 * - `sessionId` is diagnostic/session context only — never ownership.
 *
 * Deliberately excluded (do not add): email, display name, organization
 * roles/IDs, request-body user ids, frontend-selected ownership ids.
 */
export type AuthContext = Readonly<{
  userId: string;
  authProvider: "clerk";
  providerSubject: string;
  sessionId: string | null;
}>;

/**
 * Internal storage key. Only the Lucent auth middleware
 * (`requireUser` in middleware.ts) may set it; business logic must never
 * manufacture an AuthContext.
 */
const AUTH_CONTEXT_KEY = Symbol.for("lucent.authContext");

type RequestWithAuth = Request & { [AUTH_CONTEXT_KEY]?: AuthContext };

/** Middleware-only setter. Not for use in routes or business logic. */
export function setAuthContext(req: Request, ctx: AuthContext): void {
  (req as RequestWithAuth)[AUTH_CONTEXT_KEY] = ctx;
}

/**
 * Narrow accessor for route handlers. Fails loudly if the auth middleware
 * chain was not composed correctly (i.e. called on a request that never
 * passed `requireUser`).
 */
export function getAuthContext(req: Request): AuthContext {
  const ctx = (req as RequestWithAuth)[AUTH_CONTEXT_KEY];
  if (!ctx) {
    throw new Error(
      "getAuthContext(req) called but no AuthContext is attached. " +
        "The Lucent auth middleware (requireUser) must run before this handler — " +
        "check application composition in app.ts.",
    );
  }
  return ctx;
}

/** Non-throwing variant for composition-phase checks. */
export function tryGetAuthContext(req: Request): AuthContext | null {
  return (req as RequestWithAuth)[AUTH_CONTEXT_KEY] ?? null;
}

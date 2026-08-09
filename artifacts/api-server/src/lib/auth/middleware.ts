import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { AuthProviderAdapter, VerifiedProviderIdentity } from "./provider";
import { setAuthContext } from "./context";
import { resolveLucentUser, LEGACY_OWNER_SUBJECT_ENV } from "./resolver";

/**
 * Lucent authentication middleware architecture (Session B-Alpha, sections
 * 5, 7, 13).
 *
 * Final (B-Beta) composition in createApp — documented here, NOT active yet:
 *
 *   app.use(clerkVerificationMiddleware())   // Clerk verification
 *   app.use("/api", requireUser(adapter))    // Lucent require-user middleware
 *   app.use("/api", router)                  // protected API router
 *
 * The ONLY public exception will be GET /api/healthz. No additional public
 * routes may be added.
 *
 * Error contract prepared for Session B:
 *   401 — no valid authenticated provider identity
 *   403 — valid identity, but the Lucent account is disabled/unavailable
 *   404 — (B-Gamma) authenticated user requests another user's resource
 *
 * Responses never expose JWT internals, provider exception details, DB
 * details, or foreign-resource existence.
 */

const HEALTHZ_PATH = "/healthz"; // path as seen by the /api-mounted router

export type RequireUserOptions = Readonly<{
  /** Injected for tests; production reads process.env at request time. */
  legacyOwnerSubject?: string | undefined;
}>;

/**
 * The Lucent require-user middleware. Verifies external identity through
 * the provider adapter, resolves the internal Lucent user, and attaches the
 * AuthContext. B-Alpha only builds and tests it; B-Beta mounts it.
 */
export function requireUser(
  adapter: AuthProviderAdapter,
  options: RequireUserOptions = {},
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.method === "GET" && req.path === HEALTHZ_PATH) {
        next();
        return;
      }

      let identity: VerifiedProviderIdentity | null = null;
      try {
        identity = await adapter.verifyRequestIdentity(req);
      } catch {
        // Provider verification errors are treated as "no identity" — no
        // provider exception details leak to the client.
        identity = null;
      }

      if (!identity) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const legacyOwnerSubject =
        "legacyOwnerSubject" in options
          ? options.legacyOwnerSubject
          : process.env[LEGACY_OWNER_SUBJECT_ENV];

      const result = await resolveLucentUser(identity, legacyOwnerSubject);
      if (!result.ok) {
        // All failure modes are a generic 403: valid identity, but the
        // Lucent account is disabled or unavailable. No detail leaks.
        res.status(403).json({ error: "Account unavailable" });
        return;
      }

      setAuthContext(req, result.context);
      next();
    } catch (err) {
      next(err);
    }
  };
}

import type { Request } from "express";

/**
 * Provider boundary (Session B-Alpha, section 4).
 *
 * An AuthProviderAdapter answers exactly one question: "which verified
 * external identity, if any, made this request?" It performs NO Lucent user
 * resolution, NO provisioning, and NO authorization.
 *
 * Only adapter implementations may understand provider-specific request
 * state (e.g. Clerk's). The following layers must NEVER import a provider
 * SDK: financial routes/helpers, transaction semantics, XP helpers,
 * missions, Budget Guardian, evidence, allocations, database schema.
 */
export type VerifiedProviderIdentity = Readonly<{
  provider: "clerk";
  subject: string;
  sessionId: string | null;
}>;

export interface AuthProviderAdapter {
  /**
   * Returns the verified external identity for the request, or null when
   * the request is unauthenticated. Must never throw for a merely
   * unauthenticated request.
   */
  verifyRequestIdentity(req: Request): Promise<VerifiedProviderIdentity | null>;
}

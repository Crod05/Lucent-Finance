/**
 * The onboarding reset escape hatch is disabled by default. It is allowed
 * only when NODE_ENV is *exactly* "development" or "test" — any other value
 * ("production", "prod", "Production", "staging", unset, …) is treated as a
 * locked-down environment and the route responds 403.
 */
export function isOnboardingResetAllowed(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development" || nodeEnv === "test";
}

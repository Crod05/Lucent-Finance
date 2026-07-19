/**
 * Deterministic internal-user fixtures for authorization testing.
 *
 * Session A: these users are seeded ONLY into the scratch vitest database
 * (see global-setup.ts). They exist so Session B's authorization tests can
 * authenticate as stable, well-known identities without calling Clerk.
 *
 * The UUIDs are clearly reserved test values (never generated randomly, never
 * used in production). The auth_provider_subject values are fake test
 * subjects — no real Clerk accounts or tokens exist for them.
 *
 * NOTE: request authentication is NOT implemented yet. During Session A the
 * runtime still operates under the shared default-user model; these fixtures
 * are inert until Session B wires up the auth adapter.
 */
export interface TestUserFixture {
  id: string;
  authProvider: "clerk";
  authProviderSubject: string;
  email: string;
  status: "active";
}

export const TEST_USER: TestUserFixture = {
  id: "00000000-0000-4000-8000-0000000000a1",
  authProvider: "clerk",
  authProviderSubject: "test-sub-test-user",
  email: "test-user@example.test",
  status: "active",
};

export const USER_A: TestUserFixture = {
  id: "00000000-0000-4000-8000-0000000000a2",
  authProvider: "clerk",
  authProviderSubject: "test-sub-user-a",
  email: "user-a@example.test",
  status: "active",
};

export const USER_B: TestUserFixture = {
  id: "00000000-0000-4000-8000-0000000000a3",
  authProvider: "clerk",
  authProviderSubject: "test-sub-user-b",
  email: "user-b@example.test",
  status: "active",
};

export const ALL_TEST_USERS: readonly TestUserFixture[] = [TEST_USER, USER_A, USER_B];

/** The fixed UUID of the migration-created legacy owner row (migration 0003). */
export const LEGACY_OWNER_UUID = "00000000-0000-4000-8000-000000000001";

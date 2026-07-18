Claude is right that authentication needs a design decision before implementation. The most important architectural choice is not merely the login provider—it is separating **external identity** from **Lucent’s internal user ownership model**.

# Recommended decision

Use **Clerk for authentication**, while keeping Lucent’s authorization and data ownership inside PostgreSQL.

The architecture should be:

```text
Clerk identity
     ↓
Verified Clerk session/JWT
     ↓
Lucent users table
     ↓
Internal Lucent user_id
     ↓
All financial and gamification records
```

Do **not** place Clerk IDs directly as foreign keys on every Lucent table. Store the Clerk subject once on an internal `users` record, then use Lucent’s own UUID throughout the database.

That gives Lucent Clerk’s fast React and Express integration without permanently coupling the financial data model to Clerk.

Clerk currently provides dedicated React and Express integrations. Its Express middleware exposes authentication state to routes, while the React SDK provides sign-in components and hooks, making it the lowest-disruption option for Lucent’s existing React/Node architecture. ([Clerk][1])

---

# 1. Provider comparison

## Clerk — recommended for the current stage

### Strengths

* Purpose-built React support
* Official Express middleware
* Prebuilt login, registration, account, and session UI
* Minimal frontend rebuilding
* Backend receives a verified identity subject
* Lucent can continue using its existing PostgreSQL and Drizzle stack

Clerk’s official Express approach uses middleware to attach authentication state and then retrieve or enforce the authenticated user on protected routes. ([Clerk][2])

### Weaknesses

* External identity-provider dependency
* Some vendor-specific frontend components and session APIs
* Requires an internal abstraction to avoid lock-in

### Lucent suitability

**Best fit for MVP and early real-user testing.**

The financial authorization layer should still be implemented by Lucent, not delegated to Clerk. Clerk proves who the caller is; Lucent decides which accounts, transactions, budgets, evidence, and rewards that caller owns.

---

## Supabase Auth — strong alternative

### Strengths

* PostgreSQL-oriented ecosystem
* JWT-based sessions
* Can integrate closely with Row Level Security when the application database is hosted in Supabase
* JWT claims can be verified from Supabase’s JWKS endpoint
* Attractive if Lucent eventually consolidates database and authentication into Supabase

Supabase Auth issues JWTs and is designed to integrate with Supabase database authorization and Row Level Security. Its current client libraries also support verification against its JWKS endpoint. ([Supabase][3])

### Weaknesses for Lucent now

* Lucent already has its own PostgreSQL/Drizzle architecture
* Full RLS benefits are greatest when the application data is also managed through Supabase
* Adopting it may encourage an unnecessary database-platform migration
* More custom frontend auth work than Clerk’s prebuilt React flow

### Lucent suitability

A good choice if you already intend to move Lucent’s database infrastructure to Supabase. Otherwise, it creates less immediate value than Clerk.

---

## Firebase Authentication

### Strengths

* Mature identity service
* Strong email, social, phone, and mobile support
* Official server-side ID-token verification through the Firebase Admin SDK
* Useful if Lucent later becomes heavily mobile-oriented

Firebase allows its ID tokens to be sent to a custom backend, where the Admin SDK verifies the token and returns the authenticated Firebase UID. ([Firebase][4])

### Weaknesses for Lucent

* Less natural pairing with PostgreSQL and Drizzle
* Firebase’s broader platform is document-database oriented, although Auth can be used independently
* More integration code than Clerk for the current React experience
* Custom claims should not replace database ownership checks

### Lucent suitability

Technically valid, but not the most coherent choice for Lucent’s current server and database architecture.

---

## Custom JWT authentication

### Strengths

* Complete control
* No identity-provider dependency
* Potentially lower direct vendor cost at scale

### Weaknesses

Lucent would become responsible for:

* password storage and reset flows
* email verification
* account recovery
* session issuance
* refresh-token rotation
* revocation
* MFA
* signing-key rotation
* OAuth account linking
* attack protection
* secure browser token handling

JWT implementations require careful validation of signatures, issuer, audience, expiration, algorithm, and key management. Industry guidance favors asymmetric signing and secure key rotation rather than simplistic shared-secret implementations. ([Auth0][5])

### Lucent suitability

**Not recommended.** Authentication is not Lucent’s differentiating product. Building it now would consume time while increasing security risk.

---

# 2. Recommended Lucent authentication architecture

## Internal users table

Lucent should have its own stable user identity:

```ts
users
-----
id                    uuid primary key
auth_provider         varchar not null
auth_provider_subject varchar not null
email                 varchar
display_name          varchar
timezone              varchar
status                varchar not null
created_at             timestamp not null
updated_at             timestamp not null
```

Important constraints:

```text
UNIQUE(auth_provider, auth_provider_subject)
```

Recommended initial values:

```text
auth_provider = "clerk"
auth_provider_subject = Clerk userId / JWT subject
```

The external subject should only establish identity. Lucent’s internal `users.id` should be the foreign key used by application tables.

## Why use an internal UUID?

Suppose Lucent later moves from Clerk to another provider. With the internal model:

```text
Before:
users.id = lucent-uuid-123
auth_provider = clerk
auth_provider_subject = user_abc

After:
users.id = lucent-uuid-123
auth_provider = another-provider
auth_provider_subject = replacement_subject
```

Every transaction, budget, achievement, and chapter remains owned by:

```text
lucent-uuid-123
```

No financial data migration is required merely because the login provider changes.

---

# 3. Tables that need user ownership

The exact list must be generated from the repository’s current schema before implementation. However, every table representing user-created data, financial state, progression state, or user-specific configuration should either have a direct `user_id` or inherit ownership through a rigorously enforced parent relationship.

## Direct `user_id` likely required

At minimum, inspect and normally scope:

### Identity and configuration

* users
* user profiles
* user preferences
* timezone settings
* onboarding state
* notification preferences

### Financial data

* financial accounts
* transactions
* budgets
* budget periods
* bills
* recurring transactions
* savings goals
* liabilities
* investment records
* imported files or import batches
* merchant rules or personal classification rules

### Gamification data

* XP ledger
* player state
* achievements earned
* missions assigned
* mission progress
* streaks
* weekly challenges
* bonus missions
* Budget Guardian awards
* quest evidence
* chapter evidence
* future chapter progress

## Tables that may inherit ownership

Some child tables may not require a redundant `user_id` when ownership is guaranteed through a parent:

```text
transaction_allocations
    source_transaction_id → transactions.id
    target_transaction_id → transactions.id
```

However, allocation creation must verify that:

```text
source transaction owner == authenticated user
target transaction owner == authenticated user
```

and:

```text
source transaction owner == target transaction owner
```

The same applies to:

* evidence references
* budget impact child rows
* transaction relationships
* account balance history
* mission event details

For security-critical or frequently queried tables, a redundant `user_id` may still be worthwhile, but it must remain consistent with the parent through service-level validation or database constraints.

---

# 4. Default-user migration strategy

Do not remove the default-user architecture in one destructive step.

Use a staged migration.

## Stage A — create Lucent user identity

Create a real internal user record representing the existing owner:

```text
users.id = generated UUID
auth_provider = clerk
auth_provider_subject = temporarily null or pending
email = existing owner email when known
status = migration_pending
```

If the current schema already contains a placeholder user, preserve its primary key where practical rather than generating a replacement and rewriting every relationship.

## Stage B — add nullable ownership

Add `user_id` as nullable to every root user-owned table.

Example:

```ts
userId: uuid("user_id").references(() => users.id)
```

Do not immediately make it `NOT NULL`.

## Stage C — backfill existing data

Assign all existing default-user records to the migrated Lucent user:

```sql
UPDATE transactions
SET user_id = '<existing-lucent-user-id>'
WHERE user_id IS NULL;
```

Repeat for every root owned table.

The migration must produce counts:

```text
transactions backfilled: X
accounts backfilled: X
budgets backfilled: X
xp entries backfilled: X
...
```

Then verify zero orphaned records remain.

## Stage D — enforce ownership

After the backfill:

* make required `user_id` fields non-null
* add indexes on `user_id`
* add composite indexes for common user-scoped queries
* add appropriate foreign-key behavior
* prevent new ownerless records

Examples:

```text
INDEX transactions(user_id, transaction_date)
INDEX budgets(user_id, month)
INDEX xp_ledger(user_id, created_at)
UNIQUE(user_id, idempotency_key)
```

Existing global unique constraints may need to become user-scoped.

For example:

```text
Before:
UNIQUE(external_transaction_id)

Possible after:
UNIQUE(user_id, external_transaction_id)
```

This requires individual review. Some external identifiers are globally unique; others are only unique inside an account or user.

## Stage E — link the first Clerk identity

On the first authenticated login:

1. Verify the Clerk session.
2. Match the expected migration account safely.
3. Attach the Clerk subject to the existing Lucent user.
4. Change status from `migration_pending` to `active`.

Do not automatically assign the legacy financial portfolio to whichever person happens to sign in first in a public environment. Use a one-time controlled bootstrap mechanism, such as an allowed owner email stored in a deployment secret.

---

# 5. Request-level authentication model

## Authentication middleware

A central middleware should:

1. Verify the Clerk session.
2. Reject unauthenticated requests with `401`.
3. Read the provider subject.
4. Resolve the corresponding Lucent user.
5. Attach a narrow internal auth context.

Example conceptual type:

```ts
type AuthenticatedRequestContext = {
  authProvider: "clerk";
  providerSubject: string;
  userId: string;
};
```

Routes should consume:

```ts
req.authContext.userId
```

They should not repeatedly query or trust:

* request body `userId`
* query-string `userId`
* client-supplied owner identifiers
* the old default user constant
* an email address as the authoritative owner key

## Authorization rule

Every protected query must include ownership:

```ts
where(
  and(
    eq(transactions.id, transactionId),
    eq(transactions.userId, auth.userId),
  ),
)
```

Not:

```ts
where(eq(transactions.id, transactionId))
```

It is not enough to authenticate POST routes. All user-sensitive reads, writes, updates, and deletes need scoping.

## Correct response behavior

* No valid authentication: `401 Unauthorized`
* Authenticated but resource belongs to someone else: preferably `404 Not Found`
* Authenticated and owns resource but action is forbidden by role or state: `403 Forbidden`

Returning `404` for cross-user resource lookups avoids confirming that another user’s record exists.

---

# 6. Transaction and gamification boundaries

The existing atomic transaction boundary must remain intact.

Authentication resolution should happen before the financial database transaction begins:

```text
Verify identity
    ↓
Resolve Lucent user
    ↓
Validate request
    ↓
Begin existing outer Drizzle transaction
    ↓
Create user-scoped transaction
    ↓
Evaluate semantics
    ↓
Apply eligible rewards/evidence for same user
    ↓
Commit
```

Every helper called inside the financial action must receive the internal `userId` or a user-scoped transaction object.

Examples:

```ts
awardXpInTx(tx, {
  userId,
  ...
});

evaluateBudgetGuardianInTx(tx, {
  userId,
  ...
});

updateMissionProgressInTx(tx, {
  userId,
  ...
});
```

No helper should silently fall back to the shared default user.

---

# 7. Adapting the 90-test suite without rewriting it

The existing test suite should use a test-authentication harness.

## Default test principal

Create a single fixture:

```ts
export const TEST_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  providerSubject: "test_user_primary",
};
```

Most existing tests can continue using the same conceptual default user, but it should now be an explicit authenticated fixture.

## Test application factory

Build the server with injectable authentication:

```ts
createTestApp({
  auth: authenticatedAs(TEST_USER),
});
```

The production server uses Clerk verification:

```ts
createApp({
  auth: clerkAuthAdapter,
});
```

The test server uses deterministic local identity injection:

```ts
createApp({
  auth: testAuthAdapter,
});
```

This avoids making real network calls to Clerk during unit and integration tests.

## Preserve existing tests

A compatibility test setup can seed `TEST_USER` and make it the authenticated request identity by default. That allows most existing tests to remain unchanged except for centralized setup.

Avoid editing every test to manually create tokens.

## Required new authorization tests

Add focused tests for:

### Unauthenticated access

* unauthenticated GET returns 401
* unauthenticated POST returns 401
* unauthenticated PATCH returns 401
* unauthenticated DELETE returns 401

### Cross-user isolation

Create:

```text
USER_A
USER_B
```

Then prove:

* A cannot read B’s transaction
* A cannot update B’s transaction
* A cannot delete B’s transaction
* A cannot allocate against B’s transaction
* A cannot read B’s budget
* A cannot receive XP from B’s financial action
* A cannot reference B’s evidence
* A cannot trigger Budget Guardian against B’s budget

### Query scoping

Prove list routes return only the authenticated user’s data, even when both users have records with similar dates or categories.

### Atomicity

Prove authentication changes did not break:

* rollback
* XP idempotency
* evidence integrity
* duplicate handling
* Budget Guardian gating
* transaction allocations

## Do not mock authorization away

The test adapter may mock **identity verification**, but tests must still execute the real Lucent ownership filters.

This distinction is essential:

```text
Acceptable mock:
“This request belongs to USER_A.”

Not acceptable:
“Skip all ownership checks because this is a test.”
```

---

# 8. Minimum viable authentication implementation

The MVP should include only what is necessary to establish a secure single-user-to-multi-user foundation.

## Backend

* Clerk middleware configured
* central `requireAuthenticatedUser` middleware
* internal `users` table
* provider-to-internal-user resolution
* user provisioning or controlled first-login linking
* `user_id` on all root user-owned records
* complete read/write scoping
* no client-supplied ownership
* removal of runtime default-user fallbacks
* consistent 401/404 handling
* authorization tests

## Frontend

* wrap the React application with Clerk’s provider
* add sign-in page
* add sign-out control
* block protected application routes
* attach authenticated session credentials to API calls
* display loading state during session initialization
* display an unauthorized state when the session expires

Clerk provides React components and hooks for sign-in and session access, so this should not require rebuilding the financial dashboard. ([Clerk][6])

## Explicitly defer

* organizations
* household sharing
* financial-advisor access
* property-management teams
* complex roles
* social leaderboards
* admin dashboard
* family accounts
* account delegation
* custom JWT issuance
* MFA enforcement beyond provider defaults
* chapter implementation

The database may include a simple `status` field, but it should not introduce a full role-permission framework during the first implementation.

---

# 9. Critical implementation principle

Authentication and authorization must be separate concepts:

```text
Authentication:
“Who is making this request?”

Authorization:
“Does this user own or have permission to access this record?”
```

Adding Clerk middleware without adding `user_id` filters would authenticate the user but leave Lucent vulnerable to cross-user access.

The success criterion is not:

> “Users can log in.”

It is:

> “No authenticated or unauthenticated user can read or mutate another user’s financial or progression data.”

---

# 10. Recommended implementation sessions

Do not implement the entire change in one uncontrolled session.

## Session 1 — repository authorization inventory and design documentation

Replit should inspect:

* every schema table
* every route
* every service/helper
* default-user references
* unique constraints
* idempotency keys
* evidence ownership
* transaction allocation ownership
* public endpoints

Deliver:

* `docs/authentication-and-user-scoping.md`
* table ownership matrix
* route protection matrix
* migration plan
* test migration plan

No runtime changes yet.

## Session 2 — internal users and migration foundation

Implement:

* internal users table
* ownership columns
* backfill migration
* ownership indexes and constraints
* test user fixture

Do not expose production authentication yet.

## Session 3 — backend authentication and route scoping

Implement:

* Clerk adapter
* request auth context
* route protection
* service scoping
* removal of default-user runtime paths
* cross-user tests

## Session 4 — frontend session integration

Implement:

* Clerk React provider
* sign-in/sign-out
* protected routes
* authenticated API client
* session-expiration handling

## Session 5 — independent authorization audit

Codex should inspect:

* all routes
* all data reads
* all writes
* every ownership join
* every user-controlled identifier
* transaction and evidence helper propagation
* cross-user test coverage

---

# First Replit prompt: design and inventory only

Send this before any authentication implementation:

```text
Please perform an authentication and user-scoped authorization architecture
audit for Lucent Finance.

This session is documentation and design only.

Do not implement authentication.
Do not install Clerk or another provider.
Do not modify runtime code.
Do not add migrations.
Do not change schemas.
Do not modify the frontend.
Do not alter transaction semantics, Budget Guardian, XP, missions, evidence,
allocations, chapters, insights, or timezone behavior.

Current verified baseline:

- Latest verified transaction-semantics commit:
  0006930db54205e350a2cc071e39ab9bc79cfe74
- TypeScript/Node API
- React frontend
- PostgreSQL with Drizzle ORM
- deployed through Replit
- current application uses a shared default user
- routes are not yet protected by real authentication
- 90 tests currently pass
- transaction semantics and Budget Guardian are verified compliant
- financial action atomicity and evidence integrity must remain unchanged

The intended authentication direction is:

- Clerk as the external identity provider
- Lucent internal users table as the stable application identity
- Clerk subject mapped once to an internal Lucent user UUID
- all financial and gamification ownership based on internal user_id
- no direct Clerk foreign keys throughout the application schema
- no client-supplied user_id trusted for authorization

Create:

docs/authentication-and-user-scoping.md

Do not commit pasted prompt artifacts. Before completing, confirm no
attached_assets/Pasted-*.txt file was added.

--------------------------------------------------
1. CURRENT AUTHENTICATION INVENTORY
--------------------------------------------------

Inspect the actual repository and document:

- server framework and application entry points
- frontend framework and routing structure
- API client structure
- all existing user/default-user constants
- any user table or profile table already present
- any authentication-like middleware already present
- session, cookie, token, or authorization-related code
- every environment variable currently related to identity
- every public API route
- every route that reads or writes user-sensitive data

List exact files and symbols.

Do not assume a route is safe because it is GET-only.

--------------------------------------------------
2. TABLE OWNERSHIP MATRIX
--------------------------------------------------

Inventory every Drizzle table.

For each table, document:

- table name
- purpose
- current primary key
- current ownership mechanism
- whether it requires a direct user_id
- whether it can safely inherit ownership from a parent
- required ownership foreign key
- current unique constraints
- whether each unique constraint should remain global or become user-scoped
- deletion behavior
- orphan risk
- migration/backfill requirement

At minimum, inspect all tables related to:

- users and profiles
- accounts
- transactions
- transaction allocations and relationships
- budgets
- bills
- recurring transactions
- XP
- achievements
- missions
- streaks
- challenges
- Budget Guardian
- quest evidence
- chapter evidence
- imports
- classification or merchant rules
- preferences and settings

Do not add redundant user_id columns without explaining why they are needed.

For inherited ownership, document how every read and write will prove the
authenticated user owns the parent.

--------------------------------------------------
3. ROUTE PROTECTION MATRIX
--------------------------------------------------

Inventory every API route.

For each route document:

- method
- path
- source file
- current behavior
- data accessed
- whether authentication is required
- ownership checks required
- resource identifiers accepted from the client
- current cross-user exposure
- expected unauthenticated response
- expected cross-user response
- whether the operation participates in an outer database transaction

Classify routes as:

- public
- authenticated
- authenticated and resource-owner scoped
- future administrator-only

The default assumption for financial and gamification data is authenticated
and owner-scoped.

Public routes should be limited and explicitly justified, such as health
checks or authentication callbacks.

--------------------------------------------------
4. DEFAULT-USER INVENTORY
--------------------------------------------------

Find every reference to:

- default user
- hard-coded user IDs
- fallback user IDs
- global player IDs
- seed-user assumptions
- ownerless inserts
- test fixtures that assume a shared user

Classify each reference as:

- production runtime
- development seed
- migration
- test fixture
- documentation
- dead code

Propose a removal or conversion plan for every production runtime reference.

Tests may retain an explicit TEST_USER fixture, but production code must not
silently fall back to it.

--------------------------------------------------
5. INTERNAL USER MODEL
--------------------------------------------------

Design an internal Lucent user model.

At minimum address:

- internal UUID primary key
- auth provider
- auth provider subject
- unique provider/subject constraint
- email treatment
- display name
- account status
- timezone placeholder for the next project phase
- created and updated timestamps

Explain:

- why Lucent should use its internal UUID as the ownership foreign key
- why Clerk IDs should not be foreign keys throughout the financial schema
- how provider identity will be resolved to internal user_id
- whether automatic user provisioning or controlled migration linking should
  be used initially
- how duplicate provisioning races will be prevented
- what happens when a Clerk account is deleted or disabled
- what information must never be trusted directly from the request body

Do not store passwords.

--------------------------------------------------
6. EXISTING DATA MIGRATION
--------------------------------------------------

Design a staged migration for all current default-user data.

Include:

1. Create or adapt the internal users table.
2. Add nullable ownership columns.
3. Create the migrated Lucent owner record.
4. Backfill existing records.
5. Verify row counts and orphan counts.
6. Add indexes and user-scoped unique constraints where required.
7. Make required ownership columns non-null.
8. Link the migrated internal user to the intended Clerk identity using a
   controlled bootstrap process.
9. Remove production default-user fallbacks only after ownership is complete.

Document exact migration ordering.

Identify migration risks including:

- orphan records
- mismatched parent/child owners
- transaction allocations spanning owners
- evidence referencing another owner's transaction
- global unique constraints that become incorrect under multiple users
- idempotency keys colliding across users
- seeded data accidentally assigned to production users

The migration must be reversible or have a documented recovery strategy.

--------------------------------------------------
7. AUTHENTICATION ADAPTER DESIGN
--------------------------------------------------

Design a provider adapter boundary so application routes do not depend
directly on Clerk-specific objects.

Propose interfaces equivalent to:

- verifyRequestIdentity
- requireAuthenticatedUser
- resolveInternalUser
- AuthenticatedRequestContext

The application-facing auth context should expose only the fields needed by
Lucent, including the internal userId.

Document:

- where Clerk middleware would be registered
- how unauthenticated requests return 401
- how cross-user resource requests return 404 or 403
- how provider errors are converted into safe client errors
- how production and test adapters differ
- how Clerk webhooks, if used later, remain separate from normal API routes

Do not implement the adapter in this session.

--------------------------------------------------
8. SERVICE AND TRANSACTION PROPAGATION
--------------------------------------------------

Trace how internal userId must flow through:

- route handlers
- Drizzle queries
- transaction creation
- transaction updates and deletion
- allocation helper
- transaction relationship creation
- transaction semantics inputs
- Budget Guardian
- XP awarding
- achievements
- missions
- streaks
- weekly challenges
- bonus missions
- evidence creation
- idempotency helpers

Identify every helper that currently uses or assumes a default user.

For every financial action, preserve the existing single outer database
transaction.

Authentication resolution should happen before opening the financial
transaction. All mutations inside it must use the same internal userId.

--------------------------------------------------
9. TEST MIGRATION STRATEGY
--------------------------------------------------

Design a test-auth adapter that avoids real Clerk network calls.

The strategy should preserve most of the 90 existing tests by:

- defining an explicit TEST_USER
- seeding that internal user
- authenticating test requests as TEST_USER by default through centralized
  test setup
- leaving real ownership filtering enabled
- allowing individual tests to select USER_A, USER_B, or unauthenticated

Identify which test files require:

- no change
- centralized setup change only
- fixture changes
- direct assertion changes
- new cross-user cases

Required new test categories:

- unauthenticated reads and writes return 401
- authenticated list routes only return the caller's data
- USER_A cannot read USER_B data
- USER_A cannot update USER_B data
- USER_A cannot delete USER_B data
- cross-user allocations are rejected
- cross-user transaction relationships are rejected
- cross-user evidence references are rejected
- financial rewards remain attached to the correct user
- Budget Guardian evaluates only the authenticated user's budget and
  transactions
- user-scoped idempotency remains correct
- rollback and evidence integrity remain intact

Do not propose bypassing ownership checks in tests.

--------------------------------------------------
10. FRONTEND IMPACT
--------------------------------------------------

Inventory the minimum frontend changes required for Clerk:

- application provider location
- sign-in route
- sign-out control
- protected route boundary
- session-loading state
- authenticated API-client changes
- 401/session-expiration handling
- removal of any frontend default-user assumptions

Identify exact frontend files likely to change.

Do not redesign financial pages.

--------------------------------------------------
11. IMPLEMENTATION SESSIONS
--------------------------------------------------

Break implementation into bounded sessions:

Session A:
- internal user model
- ownership migration
- test fixtures

Session B:
- backend authentication adapter
- route and service scoping
- authorization tests

Session C:
- frontend Clerk integration
- authenticated API client

Session D:
- independent security and ownership audit

For each session provide:

- exact scope
- files expected to change
- migrations expected
- tests required
- explicit exclusions
- rollback or checkpoint boundary

--------------------------------------------------
12. ACCEPTANCE CRITERIA
--------------------------------------------------

Define measurable acceptance criteria including:

- no unauthenticated financial or gamification access
- no cross-user reads
- no cross-user writes
- no cross-user allocations or relationships
- no cross-user evidence
- no production default-user fallback
- every user-owned query is scoped
- internal user UUID is authoritative
- Clerk subject is mapped only through the user model
- existing atomic transaction boundary remains intact
- all existing tests continue to pass after adaptation
- new authorization tests pass
- no prompt artifact committed

--------------------------------------------------
13. COMPLETION REPORT
--------------------------------------------------

Return:

- created documentation file
- full table ownership matrix
- full route protection matrix
- every production default-user reference
- recommended internal users schema
- migration sequence
- auth adapter design
- affected helper/service inventory
- test migration plan
- frontend impact summary
- implementation-session plan
- unresolved questions or risks
- complete changed-file list

Do not describe authentication as implemented.

This session is complete only when the repository-specific design is detailed
enough for a separate implementation prompt without guessing.
```

This inventory session should happen next. It will reveal the actual tables and route surface before Lucent makes any irreversible schema decision.

[1]: https://clerk.com/docs/expressjs/getting-started/quickstart?utm_source=chatgpt.com "Express Quickstart - Getting started | Clerk Docs"
[2]: https://clerk.com/docs/reference/express/clerk-middleware?utm_source=chatgpt.com "clerkMiddleware() - SDK Reference - Express"
[3]: https://supabase.com/docs/guides/auth?utm_source=chatgpt.com "Auth | Supabase Docs"
[4]: https://firebase.google.com/docs/auth/admin/verify-id-tokens?utm_source=chatgpt.com "Verify ID Tokens | Firebase Authentication - Google"
[5]: https://auth0.com/docs/secure/tokens/token-best-practices?utm_source=chatgpt.com "Token Best Practices - Auth0 Docs"
[6]: https://clerk.com/docs/react/getting-started/quickstart?utm_source=chatgpt.com "React Quickstart - Getting started | Clerk Docs"

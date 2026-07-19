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

> **Amended sequencing note (2026-07-19):** for tables whose `user_id` is the
> runtime's live lookup key (the gamification tables keyed on the literal
> `'default-user'`), this backfill must NOT run before the runtime identity is
> rebound — see the split Stage C1/C2 in section A6 and the Session A
> implementation report.

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

---

# REPOSITORY-SPECIFIC AUDIT — Lucent Finance (added after the approved architecture above)

> **Status of this section:** Documentation-only audit performed against the actual
> repository (`Crod05/Lucent-Finance`, branch `main`, baseline commit
> `27b2cc366f32690ada9a8f2d7ec95de9cb49ddd1`). Nothing in this section is
> implemented. The architecture content above this line is the previously
> approved provider-independent design and is preserved unchanged.
>
> Labels used throughout:
> - **[APPROVED]** — decision already made in the architecture document above.
> - **[VERIFIED]** — fact confirmed by direct inspection of the repository at the baseline commit.
> - **[PROPOSAL]** — recommended design; NOT implemented.
> - **[OPEN]** — question or risk that cannot be resolved from the repository alone.

## A0. Audit baseline

- **[VERIFIED]** Branch: `main`; baseline commit `27b2cc36…` ("Add authentication and user-scoping architecture specification").
- **[VERIFIED]** Working tree at audit start: clean except this session's auto-attached prompt file (not committed, removed before checkpoint).
- **[VERIFIED]** Stack: Express 5 API (`artifacts/api-server`), React + Vite frontend (`artifacts/lucent-finance`, `wouter` routing), PostgreSQL + Drizzle ORM (`lib/db`), Orval-generated client (`lib/api-client-react`) and Zod validation (`lib/api-zod`) from `lib/api-spec/openapi.yaml`.
- **[VERIFIED]** No authentication of any kind is implemented. There is no session, cookie, token, or Authorization-header middleware in the API server.

## A1. Current authentication inventory

### Server structure — [VERIFIED]

| Item | Location |
|---|---|
| Server entry point | `artifacts/api-server/src/index.ts` (imports `app`, listens on `process.env.PORT`) |
| App factory / middleware registration | `artifacts/api-server/src/app.ts` |
| Router aggregation | `artifacts/api-server/src/routes/index.ts`, mounted at `/api` in `app.ts` |
| Global middleware (in order) | `pino-http` logging → `cors()` (permissive, default config, `app.ts` line 33) → `express.json()` / `express.urlencoded()` → routers → central error handler (generic 500, logs via `req.log`) |

- **[VERIFIED]** There is NO auth-like middleware. `artifacts/api-server/src/lib/logger.ts` redacts `req.headers.cookie`, `res.headers['set-cookie']`, and `Authorization` in logs, but nothing ever sets or reads these headers. `cookie-parser` is present as a dependency in `artifacts/api-server/package.json` but is never registered or imported anywhere in the server code — cookies are entirely unused at runtime.
- **[VERIFIED]** `SESSION_SECRET` is referenced NOWHERE in the codebase (grep across all `.ts`/`.json`: zero hits). Its existence as a workspace secret is environment context, not repository content — it is dormant either way.
- **[VERIFIED]** The only identity-adjacent env var in runtime code is `NODE_ENV`: `isOnboardingResetAllowed` (`artifacts/api-server/src/lib/env.ts`) gates `POST /api/gamification/onboarding/reset` to `development`/`test`; production returns 403.
- **[VERIFIED]** No login, logout, registration, session, identity, or user-resolution code exists anywhere.

### Client identifier trust — [VERIFIED]

- No production route reads `userId`/`playerId` from body, query, or path. Identity is implicit: the shared `DEFAULT_USER` constant.
- The application trusts, without ownership verification: transaction IDs, budget IDs, bill IDs, account IDs (all path `:id` params) — every row is reachable by every caller because there is exactly one shared owner.
- The frontend never sends or stores a user identifier (no localStorage identity, no userId params). Generated response schemas (`lib/api-zod/src/generated/api.ts`) include a server-supplied `userId` field on gamification responses — informational only.
- `lib/api-client-react/src/custom-fetch.ts` contains a dormant `setAuthTokenGetter` hook (attaches `Authorization: Bearer` when configured; lines 43–44, 354–355). It is never invoked by the web frontend. A code comment (line 41) anticipates cookie-based auth for web.

## A2. Table ownership matrix

**[VERIFIED]** All tables use `serial("id").primaryKey()` (auto-increment integers, NOT UUIDs). Nine tables exist, all in `lib/db/src/schema/`. Migrations: `lib/db/drizzle/0000_smart_kitty_pryde.sql`, `0001_fast_supernaut.sql`, `0002_salty_ben_grimm.sql`.

Two ownership regimes exist today:

1. **Financial tables — NO ownership column at all** (globally shared):

| Table | File | PK | user_id? | Unique constraints today | Proposed ownership — [PROPOSAL] |
|---|---|---|---|---|---|
| `accounts` | `accounts.ts` | serial | **none** | none beyond PK | direct `user_id uuid NOT NULL → users.id`; index `(user_id)`; reads/writes scoped `eq(accounts.userId, auth.userId)` |
| `transactions` | `transactions.ts` | serial | **none** | `transactions_fingerprint_unique` (partial, on `fingerprint`) — **currently GLOBAL** | direct `user_id`; index `(user_id, date)`; fingerprint uniqueness MUST become user-scoped: `UNIQUE(user_id, fingerprint) WHERE fingerprint IS NOT NULL` — two users legitimately produce identical fingerprints (same date/description/amount/type/accountId shape) |
| `budgets` | `budgets.ts` | serial | **none** | none (no `(category, month, year)` uniqueness exists today — [VERIFIED]) | direct `user_id`; index `(user_id, year, month)`; consider `UNIQUE(user_id, category, month, year)` as a separate, pre-existing gap ([OPEN] — duplicates are possible today) |
| `bills` | `bills.ts` | serial | **none** | none beyond PK | direct `user_id`; index `(user_id, due_date)` |
| `transaction_allocations` | `transaction_allocations.ts` | serial | **none** | CHECKs: positive amount, no self-allocation, relationship-type whitelist; FKs to `transactions.id` on both sides, `onDelete: cascade`; indexes on source and target | **inherit ownership** through BOTH parents. Invariant required: `source.user_id == target.user_id == auth.userId`. Enforcement point: `createAllocationInTx` (`api-server/src/lib/allocations.ts`) already locks both rows `FOR UPDATE` in id order — the owner-equality check belongs inside that same lock scope. Re-parenting: no update path for allocations exists today ([VERIFIED] — create only), so only INSERT needs the check. A redundant `user_id` on allocations is NOT recommended for MVP (write path is single and already row-locked; redundancy adds drift risk); revisit only if list queries need it |

2. **Gamification tables — `user_id text` with `DEFAULT 'default-user'`** (single-user scoped):

| Table | File | Unique constraint | Notes for multi-user — [PROPOSAL] |
|---|---|---|---|
| `user_progress` | `user_progress.ts` | `UNIQUE(user_id)` | already user-keyed; becomes the per-user profile row. Holds onboarding state (`onboarding_completed`) — remains one row per user |
| `daily_missions` | `daily_missions.ts` | `UNIQUE(user_id, date)` | already user-scoped and correctly keyed |
| `bonus_missions` | `bonus_missions.ts` | `UNIQUE(user_id, date)` | already user-scoped. `evidence_ref` stores `"transaction:<id>"` (builder/parser in `api-server/src/lib/evidence.ts`) — **cross-owner risk**: once transactions are owned, evidence creation must verify the referenced transaction belongs to the same user; `DELETE /transactions/:id` already nulls dangling refs atomically |
| `earned_achievements` | `earned_achievements.ts` | `UNIQUE(user_id, badge_key)` | already user-scoped (includes Budget Guardian badge) |
| `xp_events` | `xp_events.ts` | `UNIQUE(user_id, event_type, source_id)` | the idempotency backbone is ALREADY user-scoped — different users' identical `(event_type, source_id)` pairs cannot collide. No constraint change needed; only the writer must stop hardcoding `DEFAULT_USER` |

**[VERIFIED] Critical type mismatch:** gamification `user_id` columns are `text` (holding `"default-user"`), while the approved architecture calls for an internal `uuid`. The migration must either (a) keep `text` and store the UUID as text, or (b) convert columns to `uuid`. **[PROPOSAL]**: keep `text` for gamification columns in Session A (store the UUID string; avoids five column-type rewrites and preserves `xp_events` history), convert to true `uuid` FKs in a later cleanup. **[OPEN]** for review.

**Deletion behavior:** allocations cascade from transactions ([VERIFIED]). No other FK cascades exist. **[PROPOSAL]**: `users.id` FKs should be `ON DELETE RESTRICT` — never cascade-delete financial history from an identity operation; user removal is a status change (see A5).

## A3. Route protection matrix

**[VERIFIED]** Complete route inventory (all mounted under `/api`; every route is currently unauthenticated and publicly reachable). Target classification key: **P** = public, **A** = authenticated, **AO** = authenticated + resource-owner scoped.

| Method & path | File | Writes financial state | Writes gamification state | Opens outer `db.transaction` | Client-supplied IDs | Target | Cross-user response |
|---|---|---|---|---|---|---|---|
| GET `/healthz` | `health.ts` | – | – | – | – | **P** (justified: liveness) | n/a |
| GET `/accounts` | `accounts.ts` | – | – | – | – | **AO** (list-scoped) | filtered list |
| POST `/accounts` | `accounts.ts` | yes | – | – | – | **AO** | n/a (insert owned) |
| PATCH `/accounts/:id` | `accounts.ts` | yes | – | – | `id` | **AO** | 404 |
| DELETE `/accounts/:id` | `accounts.ts` | yes | – | – | `id` | **AO** | 404 |
| GET `/bills`, POST `/bills`, PATCH `/bills/:id`, DELETE `/bills/:id` | `bills.ts` | yes (writes) | – | – | `id` | **AO** | 404 |
| PATCH `/bills/:id/pay` | `bills.ts` | yes | yes (XP, mission, bonus, achievements) | **yes** | `id` | **AO** | 404 |
| GET `/budgets`, POST `/budgets`, PATCH `/budgets/:id`, DELETE `/budgets/:id` | `budgets.ts` | yes (writes) | – | – | `id` | **AO** | 404 |
| POST `/budgets/reviewed` | `budgets.ts` | – | yes (mission, XP, Budget Guardian) | **yes** | – | **AO** | n/a |
| GET `/transactions`, GET `/transactions/:id` | `transactions.ts` | – | – | – | `id` | **AO** | 404 |
| POST `/transactions` | `transactions.ts` | yes | yes (full gamification chain + Guardian) | **yes** | `accountId` in body | **AO** (must verify accountId ownership) | 404 for foreign accountId |
| PATCH `/transactions/:id` | `transactions.ts` | yes | – | – | `id` | **AO** | 404 |
| DELETE `/transactions/:id` | `transactions.ts` | yes | yes (nulls bonus evidence refs) | **yes** | `id` | **AO** | 404 |
| GET `/insights/summary`, `/insights/spending`, `/insights/trends`, `/insights/upcoming-bills` | `insights.ts` | – | – | – | – | **AO** (derived from caller's rows only) | filtered |
| POST `/insights/viewed` | `insights.ts` | – | yes (mission, XP) | **yes** | – | **AO** | n/a |
| GET `/gamification/progress`, `/missions/today`, `/achievements`, `/scorecard`, `/briefing` | `gamification.ts` | – | – (GETs are side-effect free — [VERIFIED], preserved invariant) | – | – | **AO** | filtered |
| POST `/gamification/onboarding` | `gamification.ts` | – | yes (one-time profile) | – | – | **AO** | n/a |
| POST `/gamification/onboarding/reset` | `gamification.ts` | – | yes | – | – | **AO** + remains dev/test-gated (403 in production) | n/a |

Notes — all [VERIFIED]:
- Only `/healthz` qualifies as public. No webhooks, no admin routes, no import/bulk endpoints, no allocation HTTP endpoint exists (allocations are created only via internal helper; if an endpoint is added later it is **AO** with the dual-parent invariant).
- Every route that opens an outer transaction threads `tx` through `*InTx` helpers (`xp.ts`, `budget-guardian.ts`, `allocations.ts`); none of those helpers currently receives a `userId` argument — each hardcodes `DEFAULT_USER` internally (see A4).
- Cross-user policy per the approved architecture: **404** for foreign-resource lookups (existence privacy); 403 reserved for owned-but-forbidden (currently only the production onboarding-reset gate).
- **Do not assume GETs are safe**: `/insights/*` and `/gamification/briefing` aggregate the entire `transactions`/`bills` tables today — under multi-user they leak everything unless scoped.

## A4. Default-user inventory

**[VERIFIED]** — complete list of `default-user` references:

| Location | Kind | Detail | Disposition — [PROPOSAL] |
|---|---|---|---|
| `artifacts/api-server/src/lib/xp.ts:11` | production runtime | `const DEFAULT_USER = "default-user"` used in ~18 query/insert sites (lines 206–535): `user_progress` reads/updates, `xp_events` inserts, `earned_achievements` inserts, `daily_missions`/`bonus_missions` queries | remove constant; every exported helper gains a required `userId` param (see A7). Silent fallback must not survive |
| `artifacts/api-server/src/routes/gamification.ts:45` | production runtime | duplicate constant, used in ~11 sites (lines 139–452) incl. onboarding + reset | same — routes consume `req.authContext.userId` |
| `lib/db/src/schema/{user_progress,daily_missions,bonus_missions,earned_achievements,xp_events}.ts` | schema default | `user_id text DEFAULT 'default-user'` | drop the column DEFAULT in Stage D — an ownerless insert must fail, not silently self-assign |
| `lib/db/drizzle/0000_smart_kitty_pryde.sql` | migration | SQL-level defaults mirroring the schema | superseded by a new migration; historical file unchanged |
| `artifacts/api-server/src/__tests__/*` | test-only | tests exercise the single-user API; `evidence-integrity.test.ts` already uses explicit per-test user IDs (e.g. `"evidence-test-a"`) for cross-user isolation checks | tests migrate to explicit `TEST_USER` fixture via centralized setup (A8); explicit seeded identities are acceptable |
| `replit.md`, `docs/` | documentation | describes the limitation | update after implementation |
| Frontend | — | **zero** default-user references — [VERIFIED] | no change needed for identity constants |

Functions whose signatures must eventually change (all in `artifacts/api-server/src`, all currently zero-user-argument — [VERIFIED]): `getOrCreateProgress`, `readProgress`, `awardXpForEventInTx`, `grantAchievementIfNewInTx`, `completeMissionIfPendingInTx`, `completeBonusIfAssignedInTx`, mission read helpers in `xp.ts`; `evaluateBudgetGuardianInTx` and `derivedSpentByCategoryInTx` in `budget-guardian.ts`; `createAllocationInTx` in `allocations.ts` (must additionally verify dual-parent ownership). Pure functions needing NO user (correct as-is): `evaluateTransactionSemantics`, `missionForDate`, `bonusMissionTypeForDate`, `computeFingerprint`, evidence builder/parser.

## A5. Internal user model — [PROPOSAL], repository-consistent, NOT implemented

Repository conventions observed ([VERIFIED]): snake_case columns, `text` over varchar, `timestamp defaultNow()`, CHECK-constrained text instead of pg enums, serial PKs. The `users` table breaks the serial convention deliberately (approved architecture requires a UUID ownership key).

```ts
// PROPOSED — NOT IMPLEMENTED. lib/db/src/schema/users.ts
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),          // authoritative internal owner key
    authProvider: text("auth_provider").notNull(),        // 'clerk' initially
    authProviderSubject: text("auth_provider_subject"),   // Clerk userId; NULL only while status='migration_pending'
    email: text("email"),                                 // nullable, informational; NEVER an ownership key
    displayName: text("display_name"),
    timezone: text("timezone"),                           // nullable placeholder (UTC-midnight limitation, next phase)
    status: text("status").notNull().default("active"),   // CHECK: active | disabled | migration_pending
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("users_provider_subject_unique").on(t.authProvider, t.authProviderSubject),
    // partial index alternative if NULL subjects must not collide is unnecessary:
    // Postgres UNIQUE treats NULLs as distinct, which is exactly right for migration_pending.
  ],
);
```

Key decisions (rationale in the approved architecture above; repository-specific notes here):
- Internal UUID is the ownership FK everywhere; the Clerk subject appears ONLY in `users`. Provider swap = one-row update, zero financial-data migration. **[APPROVED]**
- Email: nullable, non-unique, informational. Emails change and can be recycled; the provider subject is the identity key. **[APPROVED]**
- Provisioning race: the `(auth_provider, auth_provider_subject)` UNIQUE constraint is the backstop — concurrent first logins race to `INSERT … ON CONFLICT DO NOTHING` then re-select. **[PROPOSAL]**
- Provisioning policy for THIS repository: **controlled, not automatic**. Because a legacy portfolio exists, first sign-in must NOT auto-claim it. Bootstrap: a deployment secret (e.g. `BOOTSTRAP_OWNER_EMAIL` or better `BOOTSTRAP_OWNER_SUBJECT`) is compared against the verified Clerk identity; on match, the `migration_pending` user gets the subject attached and flips to `active`, one time. Non-matching sign-ins get fresh empty users (or a 403 "invite-only" gate — **[OPEN]**: is public sign-up wanted at MVP?). **[APPROVED direction; secret name PROPOSAL]**
- Clerk account disabled/deleted → set `status='disabled'`; NEVER delete the internal user or financial records. Provider webhooks are deferred past MVP (disabled users are caught at session verification). **[PROPOSAL]**
- Single provider mapping directly on `users` for MVP; a separate identity-link table only if multi-provider linking is ever needed. **[APPROVED]**
- No passwords, no custom tokens, no orgs/roles/households. **[APPROVED]**

## A6. Existing-data migration (repository-specific, staged) — [PROPOSAL]

Order matters; each stage is a separate reviewable migration. **No migration files are created in this session.**

1. **Stage A** — create `users`; insert the migrated owner row: `status='migration_pending'`, `auth_provider='clerk'`, subject NULL. The legacy key `"default-user"` is a text constant, not a UUID — it cannot be preserved as `users.id`; a fresh UUID is generated and recorded in migration output.
2. **Stage B** — add **nullable** `user_id uuid REFERENCES users(id) ON DELETE RESTRICT` to `accounts`, `transactions`, `budgets`, `bills`. Gamification tables keep `text user_id` for now (A2 decision) — no column add needed there.
3. **Stage C** — backfill (SPLIT by the 2026-07-19 amendment — see the Session A implementation report):
   - **Stage C1 (done in Session A)**: `UPDATE accounts/transactions/budgets/bills SET user_id = '<owner-uuid>' WHERE user_id IS NULL;` — emit per-table counts; verify zero NULL rows remain.
   - **Stage C2 (Session B ONLY — hard gate)**: `UPDATE user_progress/daily_missions/bonus_missions/earned_achievements/xp_events SET user_id = '<owner-uuid>' WHERE user_id = 'default-user';` — this MUST land atomically with the `DEFAULT_USER` removal and runtime userId rebind, never earlier: relabeling gamification rows while the runtime still reads `'default-user'` makes the app lazily recreate empty rows and hides all existing XP/achievement history (this exact regression occurred and was reverted). Only after Stage C2 does "zero `'default-user'` rows" become a verification target.
4. **Stage C-verify** — owner-consistency checks (all must return 0 rows):
   - allocations whose source and target transactions have different `user_id`;
   - `bonus_missions.evidence_ref` parsing to a transaction id whose owner differs from the mission's owner (use `findOrphanedTransactionEvidenceRefs` in `api-server/src/lib/evidence.ts` as the parsing reference);
   - `transactions.account_id` pointing at an account with a different owner.
   - Single-owner backfill makes mismatches impossible unless data is already corrupt; run the checks anyway.
5. **Stage D** — enforce: `SET NOT NULL` on the four financial `user_id` columns; drop `DEFAULT 'default-user'` from the five gamification columns; add indexes `transactions(user_id, date)`, `budgets(user_id, year, month)`, `bills(user_id, due_date)`, `accounts(user_id)`, `xp_events(user_id, created_at)`; **replace** `transactions_fingerprint_unique` with `UNIQUE(user_id, fingerprint) WHERE fingerprint IS NOT NULL` (the dedup 409 contract in `routes/transactions.ts` is unchanged in behavior, now per-user).
6. **Stage E** — controlled bootstrap linking (runtime, not SQL): first verified Clerk sign-in matching the bootstrap secret attaches the subject and activates the owner (A5).

Constraint review ([VERIFIED] full list): `xp_events` UNIQUE is already user-scoped (correct); `daily_missions`/`bonus_missions`/`earned_achievements`/`user_progress` UNIQUEs are already user-scoped (correct); `transactions_fingerprint_unique` is the ONLY global constraint that must become user-scoped; `transaction_allocations` CHECKs are user-agnostic (correct as row-level rules).

Risks: cascade-delete via `users` (mitigated: RESTRICT); nullable ownership lingering (mitigated: Stage D is a hard gate for Session B); wrong-account claim of legacy portfolio (mitigated: bootstrap secret, never first-come-first-served); seeded dev fixtures in prod tables ([OPEN]: production DB contents cannot be inspected from this audit — run Stage C counts against production before Stage D). Rollback: Stages A–C are additive and reversible (drop column / delete rows); Stage D is reversible by dropping constraints; take a DB snapshot before Stage C and D.

## A7. Authentication adapter & propagation design — [PROPOSAL]

Integration points (exact, from the verified structure):
- Adapter interface + `AuthenticatedRequestContext` type: new `artifacts/api-server/src/lib/auth.ts`. Context exactly `{ authProvider: "clerk"; providerSubject: string; userId: string }` — no extra fields needed for MVP; the Clerk session object is never exposed past the adapter.
- Registration: in `app.ts`, after body parsing, before `app.use("/api", router)`. `/api/healthz` moves to (or is exempted on) a public mini-router; everything else behind `requireAuthenticatedUser`.
- Resolution: once per request — verify Clerk session → look up `users` by `(provider, subject)` → attach context (`req.authContext`); missing internal user → controlled provisioning path (A5); `status='disabled'` → 403; no/invalid credentials → 401; provider outage → 503 with generic body (never a stack leak; the central error handler in `app.ts` already provides this shape).
- Test adapter: `createApp({ auth })` dependency injection — production passes the Clerk adapter, tests pass `authenticatedAs(TEST_USER)` which stamps the context deterministically with NO network calls. This mirrors the existing in-process DI precedent (`setFailpointHandler` in `lib/failpoints.ts` — [VERIFIED]). Tests bypass identity *verification* only; all ownership filters run for real.
- Frontend transport: same-origin through the shared proxy ([VERIFIED] — relative URLs via `custom-fetch.ts` base URL). Clerk's session cookie therefore travels automatically; the dormant `setAuthTokenGetter` remains for future mobile. The permissive `cors()` in `app.ts` must be tightened when credentials become meaningful. Webhooks, if ever added, live on a separate router with independent signature verification.

Propagation map (route → chain, all [VERIFIED] call chains): every `*InTx` helper listed in A4 gains a required `userId: string` first-class argument; routes pass `req.authContext.userId`; every Drizzle query inside gains an `eq(<table>.userId, userId)` conjunct; inserts set `userId` explicitly. Authentication resolution happens in middleware — **before** any `db.transaction` opens — so the approved flow (verify → resolve → validate → single outer tx → scoped mutation → semantics → Guardian → XP/evidence → commit) maps 1:1 onto the existing structure. The single-outer-transaction architecture is currently intact across create/pay/reviewed/viewed/delete ([VERIFIED] via `atomic-rollback.test.ts` + route inspection); the only way auth work could break atomicity is by doing user lookup *inside* a route transaction or opening a second transaction in a helper — prohibited.

Cross-user allocation invariant: enforce inside `createAllocationInTx` while both rows are locked: after `FOR UPDATE`, assert `source.userId === target.userId === userId`, else typed `AllocationError` mapping to 404.

## A8. Test migration strategy — [PROPOSAL] (framework facts [VERIFIED])

Facts: Vitest, `fileParallelism: false`, forks pool, scratch `lucent_vitest` DB built from checked-in migrations by `global-setup.ts`, native `fetch` against `app.listen(0)`, failpoint DI. 8 test files, 90 tests.

Fixtures: `TEST_USER`, `USER_A`, `USER_B` — each `{ id: fixed UUID, authProvider: 'clerk', authProviderSubject: 'test-sub-…', email, status: 'active' }`, seeded in centralized setup; default app instance authenticated as `TEST_USER`.

Per-file classification:
- **Centralized-setup change only** (routes exercised via fetch; assertions unchanged): `atomic-rollback.test.ts`, `transaction-duplicates.test.ts`, `transaction-gating.test.ts`, `reset-gating.test.ts`.
- **Fixture change required** (direct DB seeding must add owner columns): `budget-guardian.test.ts`, `evidence-integrity.test.ts` (its ad-hoc user strings become `USER_A`/`USER_B`).
- **No change expected**: pure-evaluator portions of `transaction-semantics.test.ts`; its HTTP portions take the centralized setup. `global-setup.ts` gains fixture seeding.
- **High regression risk**: none identified, provided the test adapter is DI-based and ownership filters stay on.

New coverage required (est. ~40–60 new tests): 401 suite for every protected method family; list-isolation (accounts/transactions/budgets/bills/gamification reads); cross-user 404s for read/update/delete on each resource; cross-user allocation and evidence rejection; foreign `accountId` in POST /transactions; reward attribution (USER_A's action never credits USER_B); user-scoped fingerprint dedup (same fingerprint across two users succeeds; retry within one user still 409); Guardian evaluates only the caller's budgets/transactions; rollback + failpoints unchanged under auth; provisioning-race constraint test; migration verification queries.

## A9. Frontend impact — [PROPOSAL] (structure facts [VERIFIED])

Facts: entry `src/main.tsx` → `App.tsx`; providers: `QueryClientProvider`, `TooltipProvider`, wouter `Router` (base = `import.meta.env.BASE_URL`), `Toaster`; pages: accounts, bills, budgets, dashboard, insights, not-found, onboarding, progress, settings, transactions; API via generated hooks + `custom-fetch.ts`; no credentials logic anywhere today; no frontend default-user assumptions.

Minimum future change set: wrap providers with `<ClerkProvider>` in `main.tsx`/`App.tsx`; add a sign-in page + signed-out gate around all existing routes (all 10 pages require auth; only the sign-in screen is public); sign-out control in `settings.tsx` (or layout); session-loading state before first render of protected routes; 401 interception in `custom-fetch.ts` → redirect to sign-in; `VITE_CLERK_PUBLISHABLE_KEY` env var; no financial-page redesign. Cookies ride same-origin — no Authorization-header work for web MVP.

## A10. Implementation sessions — [PROPOSAL]

- **Session A — user table + ownership migration.** Files: `lib/db/src/schema/users.ts` (new), edits to 4 financial schema files (+5 gamification files in Stage D), new migrations `0003+` (staged per A6), `global-setup.ts` + fixture module, backfill-verification script in `scripts/`. Tests: migration verification + fixture smoke. Checkpoint after Stage D verification passes on dev DB. Rollback: snapshot + additive-stage reversal. Excludes: Clerk middleware, frontend, route scoping, orgs/roles/chapters/timezone-beyond-nullable-column, refactors.
- **Session B — backend auth + scoping.** Files: new `lib/auth.ts` (adapter, context, middleware), `app.ts` (createApp DI + registration), all 7 route files (ownership conjuncts + context consumption), `xp.ts`/`budget-guardian.ts`/`allocations.ts` (userId params + dual-parent check), removal of both `DEFAULT_USER` constants, OpenAPI spec 401/404 responses + codegen. Tests: full new-coverage suite from A8. Must preserve: outer-tx boundaries, rollback, failpoints, idempotency, evidence, Guardian, semantics — the existing 90 tests keep passing after authorized adaptation. Checkpoint: all green.
- **Session C — frontend Clerk.** Files per A9 + `VITE_CLERK_PUBLISHABLE_KEY` + deployment config. Excludes redesigns. Checkpoint: signed-out users see only sign-in; signed-in flow works end-to-end.
- **Session D — independent audit.** Checklist: every A3 row re-verified against implementation; grep gates (`DEFAULT_USER` = 0 production hits, no unscoped `db.select` on owned tables); DB verification queries from A6 Stage C-verify run against production; negative security tests executed; release blocked on ANY cross-user read/write, any ownerless row, or any unauthenticated non-public route.

## A11. Acceptance criteria (measurable) — [PROPOSAL]

Authentication: every non-`/healthz` route → 401 unauthenticated; Clerk verified only inside the adapter; routes consume only `req.authContext`; disabled users → 403. Identity: internal UUID is the only ownership FK; provider subject exists only in `users`; `UNIQUE(auth_provider, auth_provider_subject)` enforced; email never an ownership key. Ownership: zero NULL owners on required columns; every owned query carries the user conjunct; cross-user read/update/delete/allocate/evidence/reward/Guardian all impossible (tested); no client-supplied user ID trusted; zero production `DEFAULT_USER` references. Migration: per A6 with recorded counts and zero-orphan verification; fingerprint uniqueness user-scoped; xp idempotency user-scoped (already is). Atomicity: single outer transaction preserved; auth resolution precedes it; same userId across every mutation within it; all 90 existing tests pass post-adaptation; failpoint suite intact. Frontend: signed-out lockout, loading state, 401 handling, no default-user assumptions. Hygiene: no prompt artifacts, no unrelated file changes, per-session clean checkpoints, nothing described as implemented until it is.

## A12. Open questions and unverifiable assumptions

- **[OPEN]** Is public self-service sign-up desired at MVP, or invite-only single-owner? Determines the non-bootstrap provisioning path (A5).
- **[OPEN]** Gamification `user_id` columns: keep `text` (recommended for Session A) or convert to `uuid` immediately?
- **[OPEN]** `budgets` lacks any `(user, category, month, year)` uniqueness today — pre-existing duplicate risk; fix alongside ownership or defer?
- **[OPEN]** Production DB contents could not be inspected in this audit; Stage C/D verification must run against production data before constraints tighten.
- **[OPEN]** Clerk plan/feature availability (session cookie behavior behind the Replit proxy) is assumed per Clerk's standard same-origin cookie model; verify in Session C.
- **Assumption (inferred, not verified):** no out-of-band clients exist besides the bundled frontend; if any external script hits the API, Session B's 401 wall breaks it by design.

*End of repository-specific audit. Nothing above the divider was modified; nothing in this section is implemented.*

---

## Session A implementation report (implemented 2026-07-19; amended same day)

Everything in this section IS implemented and verified. Sessions B–D remain proposals.

> **Amendment (2026-07-19):** the original Session A checkpoint deviated in two
> ways and was corrected before approval: (1) the migration initially relabeled
> gamification rows from `'default-user'` to the owner UUID, which hid existing
> XP/achievement/mission history from the current runtime — that backfill has
> been REMOVED from the checked-in migration and deferred to Session B, and the
> dev database was restored so existing progression is visible again; (2) a
> pre-existing orphaned bonus-mission evidence ref was initially repaired
> (nulled) — that repair was reverted; the anomaly is now detected and
> REPORTED by the verification tooling, never silently fixed. Details below.

### What was built

1. **`users` table** (`lib/db/src/schema/users.ts`): uuid PK (`gen_random_uuid()`), `auth_provider` NOT NULL, nullable `auth_provider_subject` / `email` / `display_name` / `timezone`, `status` text DEFAULT `'active'` with CHECK (`active|disabled|migration_pending`), timestamps, `UNIQUE(auth_provider, auth_provider_subject)` (`users_provider_subject_unique`; NULL subjects are distinct, so multiple `migration_pending` placeholders can coexist).
2. **Nullable ownership columns**: `user_id uuid REFERENCES users(id) ON DELETE RESTRICT` added to `accounts`, `transactions`, `budgets`, `bills`. No default, omitted from every insert schema — Session A writers do not set ownership. Indexes: `accounts_user_id_idx`, `transactions_user_id_date_idx`, `budgets_user_id_year_month_idx`, `bills_user_id_due_date_idx`. No `(user_id, created_at)` index on `xp_events` — its existing UNIQUE `(user_id, event_type, source_id)` already leads with `user_id`.
3. **Migration `0003_dapper_patch.sql`** (drizzle-generated DDL + hand-authored deterministic backfill): inserts ONE legacy owner with the fixed documented UUID `00000000-0000-4000-8000-000000000001` (`clerk`, NULL subject, `status='migration_pending'`, `ON CONFLICT (id) DO NOTHING`), then backfills ONLY the four financial tables (`user_id = owner WHERE user_id IS NULL`). **The five gamification tables are deliberately NOT touched** — the checked-in migration contains no gamification UPDATE statements (guarded by a static test). Verified to build a fresh DB end-to-end via `pnpm --filter @workspace/db run migrate` on a scratch database.
4. **Dev DB application**: the dev database has no drizzle journal (built via `push`), so the migration SQL was applied via psql in a single transaction after a `pg_dump` snapshot. Financial backfill counts: accounts 3, transactions 20, budgets 7, bills 8 — zero NULL owners after backfill; exactly one `migration_pending` owner. Gamification rows (user_progress 1, daily_missions 9, bonus_missions 2, earned_achievements 3, xp_events 7) remain under `'default-user'`, so all existing XP (315), level (3), streaks (current 1 / longest 5), achievements, and missions stay visible through the current runtime.
5. **Verification script** `scripts/src/verify-session-a.ts` (`pnpm --filter @workspace/scripts run verify-session-a`): read-only; checks owner row shape, financial NULL-owner counts, that NO gamification row carries the owner UUID (premature migration = FAIL), transaction↔account owner equality, allocation source/target owner equality, and detects orphaned bonus-mission evidence refs (canonical `transaction:<id>` format, mirrored from `evidence.ts`'s strict parser) as reported `[ANOMALY]` items. Exit contract: 1 on any FAIL; 0 with an explicit summary line when only known anomalies are present.
6. **Test fixtures** (`artifacts/api-server/src/__tests__/fixtures/users.ts`): `TEST_USER`, `USER_A`, `USER_B` with fixed reserved UUIDs, `clerk` provider, unique fake test subjects, `active` status; seeded into the scratch vitest DB by `global-setup.ts` after migrations. Inert until Session B.
7. **Foundation tests** (`session-a-foundation.test.ts`, 16 tests): fixture presence, uuid default, provider-subject uniqueness, NULL-subject coexistence, status CHECK, single migration_pending owner, nullable/no-default ownership columns, FK rejection, RESTRICT enforcement, ownership indexes, **global** fingerprint uniqueness (schema + behavioral cross-user collision proof), gamification columns still text with DEFAULT `'default-user'`, a static guard that migration 0003 contains NO gamification UPDATE statements, a check that no gamification row carries the owner UUID, and the xp idempotency key intact.

### Known anomaly (reported, NOT repaired)

- **Orphaned bonus-mission evidence ref (pre-existing)**: dev-DB `bonus_missions` row **id 2** has `evidence_ref = 'transaction:29'`; transaction 29 does not exist (dev transactions span ids 1-26). The `pg_dump` pre-migration snapshot proves the reference predates Session A - it is stale data from before the delete-clears-evidence runtime fix landed (transaction 29 was evidently deleted before that fix existed). **No checked-in migration modifies this row.** During the original (pre-amendment) work the local dev row was temporarily nulled; that repair was **reverted** from the snapshot value, so the dev DB again holds `transaction:29` and the verification script reports it as `[ANOMALY]`. Recommended separate repair procedure (requires explicit approval): null the ref - never remap - mirroring the runtime `DELETE /transactions/:id` semantics, via a one-off reviewed statement such as `UPDATE bonus_missions SET evidence_ref = NULL WHERE id = 2 AND evidence_ref = 'transaction:29';`, and record it in this document.

### Explicitly NOT done (Session B+ hard gates)

- No authentication (no auth middleware; Clerk not integrated).
- No authorization; all routes remain unprotected and unscoped.
- No NOT NULL on the financial ownership columns (they stay nullable until Session B updates every writer).
- Fingerprint uniqueness remains **global** (documented gate in `transactions.ts`).
- `DEFAULT_USER` constants untouched; runtime behavior unchanged.
- **Gamification ownership migration deferred to Session B**, where it must happen atomically with: removal of both `DEFAULT_USER` constants, propagation of the authenticated internal userId, conversion of gamification `user_id` from text to uuid with FKs to `users`, updates to every gamification reader/writer, and verification that all existing history remains visible through the migrated owner. Until then gamification data remains on `'default-user'` so current behavior is preserved. No temporary compatibility fallback, duplicate rows, or second default owner were introduced.

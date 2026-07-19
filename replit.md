# Lucent Finance

A personal finance app (transactions, budgets, bills, accounts, insights) with a gamified "behavioral OS" layer — daily missions, bonus missions, weekly challenges, XP, levels, streaks, and an evolving Financial Class.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-server run test` — run the API test suite (vitest; creates a scratch `lucent_vitest` DB from the checked-in migrations, never touches the dev DB)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — Drizzle schema (source of truth for tables); `lib/db/drizzle/` — checked-in SQL migrations (verified to build a fresh DB via `pnpm --filter @workspace/db run migrate`)
- `lib/api-spec/openapi.yaml` — API contract (source of truth); Orval generates `lib/api-zod` (server validation) and `lib/api-client-react` (React Query hooks)
- `artifacts/api-server/src/routes/` — Express routes; `artifacts/api-server/src/lib/xp.ts` — all gamification logic (XP, missions, bonus, weekly challenge, streaks, class evolution)
- `artifacts/lucent-finance/src/pages/` — frontend pages

## Architecture decisions

- **Idempotency backbone**: every XP grant is a row in `xp_events` with a unique `(userId, eventType, sourceId)` key — replays, refreshes, and concurrent requests can never double-award.
- **Atomic action writes**: one user action = exactly ONE `db.transaction`. The four action routes (`POST /transactions`, `PATCH /bills/:id/pay`, `POST /budgets/reviewed`, `POST /insights/viewed`) open a single transaction and thread its `tx` through the exported `*InTx` helpers in `xp.ts` and `budget-guardian.ts` (`DbTx` type). Standalone wrappers just open a transaction and delegate — never call a wrapper from inside a route transaction (that would nest). Any failure mid-chain rolls back the financial row AND all gamification writes; the client gets a generic 500 from the central error middleware in `app.ts` (full error goes to `req.log`, nothing leaks). Failure-injection tests use `lib/failpoints.ts` (`setFailpointHandler` — in-process test-only DI, no env/query switch) with named points inside the route transactions.
- **GETs are side-effect free.** Daily/bonus mission assignment is a pure function of the date (`missionForDate`, `bonusMissionTypeForDate` in `xp.ts`); rows are only materialized when a real action completes them. Mission completion happens exclusively in POST/PATCH routes, including the explicit intent endpoints `POST /budgets/reviewed` and `POST /insights/viewed`.
- **Weekly challenge** is calendar-week based (Mon–Sun, UTC): 5 completed daily missions in the week award +50 XP once, keyed on `(weekly_challenge, weekStart)` in `xp_events`.
- **Bonus missions persist** in `bonus_missions` (unique per user+date) with an `evidence_ref` pointing at the real transaction/bill; bonus XP (+15) is a separate idempotent event.
- **Onboarding is immutable**: a conditional UPDATE (`onboarding_completed = false`) enforces one-time character creation → 409 on repeats. Input is trimmed + strictly validated (unknown fields → 400). The onboarding reset is disabled by default: it responds 403 unless `NODE_ENV` is exactly `"development"` or `"test"` (`isOnboardingResetAllowed` in `api-server/src/lib/env.ts`); the Settings "Replay" card renders only in dev builds.
- **Transaction dedup is DB-enforced**: `computeFingerprint` (`api-server/src/lib/fingerprint.ts`) hashes (date, normalized description, amount, type, accountId); a partial unique index (`transactions_fingerprint_unique`, migration `0001_fast_supernaut`) rejects duplicate non-null fingerprints even under concurrency. Duplicate creates and updates return an explicit 409 with `{duplicate: true, existingId}` — never a silent success. Updates recalculate the fingerprint from the merged fields.
- **Evidence-reference integrity**: the `"transaction:<id>"` evidence format lives only in `api-server/src/lib/evidence.ts` (builder, strict parser, and `findOrphanedTransactionEvidenceRefs` validator). Migration `0001`'s duplicate cleanup remaps bonus-mission evidence refs to the same-fingerprint-group survivor *before* deleting duplicates. At runtime, `DELETE /transactions/:id` atomically clears (nulls, never remaps) any bonus-mission evidence ref pointing at the deleted row.
- **Budget Guardian** (`api-server/src/lib/budget-guardian.ts`) is a one-time badge for finishing a fully completed calendar month at or below every active budget for that month. Evaluated idempotently from action routes (transaction create, budgets reviewed) for the previous completed UTC month; never granted for the current/incomplete month or a month with no budgets. Eligibility is judged **exclusively** on evaluator-derived per-category spending (`derivedSpentByCategoryInTx`, which assembles facts including out-of-month allocation sources/targets and sums evaluator budget impacts); the legacy `budgets.currentSpent` aggregate is display-only and never an eligibility guard (a stale `currentSpent` can neither deny nor grant the badge). In `POST /transactions` the Guardian evaluation only runs when the created row's `effects.guardianEligible` is true.
- **Transaction semantics** (`docs/transaction-semantics.md` is the spec; `api-server/src/lib/transaction-semantics.ts` is the ONLY implementation): transactions store classification FACTS (`classification`, `classification_status`, `classification_confidence`, `classification_source` — CHECK-constrained text columns, migration `0002_salty_ben_grimm` with backfill mapping legacy `type` income/expense → confirmed/high/`legacy_type`), never stored policy booleans. All meaning (income/spending/budget amounts, net-worth impact, gamification eligibility, review flags) is derived at read time by the pure, synchronous `evaluateTransactionSemantics(facts)` — it does zero DB queries; callers assemble facts. All meaning also includes per-surface eligibility (`guardianEligible`, `questEvidenceEligible`, `chapterEvidenceEligible`, plus the `eligibleForGamification` aggregate) and a conservative `savingsAmount` (currently always 0 — the input facts carry no verified destination-account information, so no savings effect is manufactured; reserved for future use). Allocation links live in `transaction_allocations` (relationship types: `refund_of`, `reimbursement_of`, `transfer_pair`, `reversal_of`, `correction_of`). The database enforces only row-level constraints (positive `allocated_amount`, no self-allocation, valid relationship type, foreign keys); **aggregate over-allocation is enforced by the transaction-safe helper**, not by any DB aggregate constraint: `api-server/src/lib/allocations.ts` `createAllocationInTx` locks source+target rows `FOR UPDATE` in id order and rejects source- and target-side over-allocation with typed `AllocationError` codes. Manual API creates/updates map `type` → confirmed classification via `classificationForManualType` in `routes/transactions.ts`; the gamification chain in POST /transactions is gated on `effects.eligibleForGamification` and Budget Guardian on `effects.guardianEligible` (unclassified/suggested/ambiguous rows earn nothing). No classification UI or auto-matching yet.
- **Auth foundation (Session A, no auth yet)**: `users` table (uuid PK, `UNIQUE(auth_provider, auth_provider_subject)`, status CHECK) plus nullable `user_id uuid` FKs (ON DELETE RESTRICT) on accounts/transactions/budgets/bills — migration `0003_dapper_patch` also deterministically backfills all pre-existing rows to the fixed legacy owner `00000000-0000-4000-8000-000000000001` (status `migration_pending`). Runtime is UNCHANGED: writers do not set `user_id`, `DEFAULT_USER` remains, fingerprint uniqueness is still global (Session B gate documented in `transactions.ts`), gamification `user_id` stays text. Verify with `pnpm --filter @workspace/scripts run verify-session-a`; test users seeded in vitest global-setup (`__tests__/fixtures/users.ts`). Full plan + implementation report: `docs/authentication-and-user-scoping.md`. Note: after backfill the dev app shows fresh default-user progress until Session B rebinds runtime identity (history preserved under the owner UUID).
- **UTC-midnight limitation**: all gamification dates ("today", Mon–Sun weeks, streaks, completed months) roll over at 00:00 UTC, not player-local time. Timezone support is NOT implemented; the date helpers in `api-server/src/lib/xp.ts` are the single place to thread a player timezone through later.

## Product

Lucent Finance is a personal finance app with a gamified "behavioral OS" layer:
- **Onboarding / character creation**: name, spawn point (life stage), primary concern, and a starting Financial Class. Gated by `onboardingCompleted` on `user_progress`.
- **Financial Class (HYBRID)**: chosen class is a floor; evolves UP with XP (Survivor → Builder → Investor → Strategist → Owner → Legacy Builder). Class Evolution bar on dashboard + progress pages.
- **Daily Mission Briefing** (dashboard): time-of-day greeting by name, a primary daily mission, optional real-backed bonus mission, weekly challenge (5 missions per calendar week, Mon–Sun), and today's spending insight.
- **XP / levels / streaks / achievements** tracked on the progress page.
- Single-user model: `DEFAULT_USER = "default-user"`. "Replay Character Creation" in Settings resets onboarding.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After editing `lib/api-spec/openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen` before typechecking.
- After editing `lib/db/src/schema/`, run `pnpm --filter @workspace/db run push` (dev DB) AND `run generate` so the checked-in migrations in `lib/db/drizzle/` stay in sync.
- The bill "pay" endpoint is `PATCH /api/bills/:id/pay` (not POST).
- When assembling evaluator facts for a month, load EVERY allocation target's transaction row — a source split across in-month and out-of-month targets otherwise looks "unresolved" and its legitimate offset gets suppressed (covered by a regression test in `transaction-semantics.test.ts`).

## SECURITY — shared-user exposure (launch blocker)

> **⚠️ WARNING: any live deployment of this app is PUBLICLY WRITABLE.** Every visitor shares the single `default-user` account and can read AND modify everything. **Do not put real personal financial data into a deployed instance.** Demo/sample data only until authentication lands.

The app has **no authentication**. Every route reads and writes data for the single hardcoded user `default-user`:

- All financial data (transactions, budgets, bills, accounts) is shared: any visitor can view it and mutate it via every POST/PATCH/DELETE endpoint.
- All gamification state (XP, streaks, achievements, onboarding profile including the player's name) is likewise shared and publicly writable.
- Mitigations shipped: onboarding is immutable (409), the onboarding reset is blocked in production (403), and all XP awards are idempotent — but these limit abuse, they do not provide privacy or isolation.

**Do not publish this app for real multi-person use until authentication (e.g. Replit Auth) and per-user data scoping are added.** Fine for a personal/demo deployment where the URL is private.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

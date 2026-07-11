# Lucent Finance

A personal finance app (transactions, budgets, bills, accounts, insights) with a gamified "behavioral OS" layer — daily missions, bonus missions, weekly challenges, XP, levels, streaks, and an evolving Financial Class.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
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
- **GETs are side-effect free.** Daily/bonus mission assignment is a pure function of the date (`missionForDate`, `bonusMissionTypeForDate` in `xp.ts`); rows are only materialized when a real action completes them. Mission completion happens exclusively in POST/PATCH routes, including the explicit intent endpoints `POST /budgets/reviewed` and `POST /insights/viewed`.
- **Weekly challenge** is calendar-week based (Mon–Sun, UTC): 5 completed daily missions in the week award +50 XP once, keyed on `(weekly_challenge, weekStart)` in `xp_events`.
- **Bonus missions persist** in `bonus_missions` (unique per user+date) with an `evidence_ref` pointing at the real transaction/bill; bonus XP (+15) is a separate idempotent event.
- **Onboarding is immutable**: a conditional UPDATE (`onboarding_completed = false`) enforces one-time character creation → 409 on repeats. Input is trimmed + strictly validated (unknown fields → 400). The reset endpoint is registered only when `NODE_ENV !== "production"` (returns 403 in production) and the Settings "Replay" card renders only in dev builds.

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

## SECURITY — shared-user exposure (launch blocker)

The app has **no authentication**. Every route reads and writes data for the single hardcoded user `default-user`:

- All financial data (transactions, budgets, bills, accounts) is shared: any visitor can view it and mutate it via every POST/PATCH/DELETE endpoint.
- All gamification state (XP, streaks, achievements, onboarding profile including the player's name) is likewise shared and publicly writable.
- Mitigations shipped: onboarding is immutable (409), the onboarding reset is blocked in production (403), and all XP awards are idempotent — but these limit abuse, they do not provide privacy or isolation.

**Do not publish this app for real multi-person use until authentication (e.g. Replit Auth) and per-user data scoping are added.** Fine for a personal/demo deployment where the URL is private.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

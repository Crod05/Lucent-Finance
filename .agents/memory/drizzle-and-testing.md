---
name: Drizzle migrations & DB test infrastructure
description: How migrations, drizzle config paths, and the vitest scratch-DB setup work in this repo.
---

**Rule:** Keep `drizzle.config.ts` paths relative (`./drizzle`, `./src/schema/index.ts`) and always run drizzle scripts via `pnpm --filter @workspace/db run <script>` so cwd is `lib/db`.
**Why:** Absolute `path.join(__dirname, ...)` paths made `drizzle-kit generate` fail with ENOENT (`.//home/...`) because drizzle-kit prefixes `out` with `./` and resolves it against cwd.
**How to apply:** Any new drizzle-kit invocation or config edit: relative paths + package-dir cwd.

**Rule:** Schema changes need BOTH `run push` (dev DB) and `run generate` (checked-in migration); hand-edit the generated SQL when data cleanup must precede a new constraint (e.g. deterministic keep-lowest-id DELETE before a unique index), separated by `--> statement-breakpoint`.
**Why:** Migrations must succeed against real data states, not just fresh DBs; verify risky ones against a `pg_dump` copy of the live DB seeded with the bad state.

**Testing:** API tests (vitest, `artifacts/api-server`) build a scratch `lucent_vitest` DB in globalSetup from the checked-in migrations and repoint `DATABASE_URL` — never the dev DB. The generated API client throws `ApiError` with top-level `status`/`data` (fetch-based, NOT axios `err.response`). API date responses serialize as full ISO timestamps even for date-only columns. PATCH bodies pass through `zod.coerce.date()` → Date objects: normalize to `YYYY-MM-DD` before hashing/storing (a missed normalization silently broke fingerprint dedup once).

**Rule:** Cross-table soft references (`bonus_missions.evidence_ref` = `"transaction:<id>"`, `"bill:<id>"`) have no FK — any migration or runtime path that deletes referenced rows must remap (duplicates → same-group survivor) or NULL the refs first; never attach evidence to an unrelated row. Format helpers + orphan validator live in one module (`evidence.ts`).
**Why:** The 0001 duplicate-cleanup DELETE would have silently orphaned evidence refs; dev/prod DBs keep no drizzle journal (push-managed), so pre-release migrations can be amended in place — scratch/test DBs rebuild from files.

## Session A additions (2026-07)
- The dev DB was built via `drizzle-kit push` and has NO migrations journal — never run `migrate` against it. Apply new checked-in migration SQL manually via `psql --single-transaction` (strip `--> statement-breakpoint`), after a pg_dump snapshot; verify the same file on a scratch DB with `run migrate` first.
- Drizzle `db.execute` rejections are wrapped ("Failed query: …") with the real Postgres error on `.cause` — constraint-name assertions must check `err.cause.message`, not the top-level message.
- Staged ownership migrations that relabel gamification rows away from the runtime's hardcoded identity make the app lazily recreate fresh rows (looks like an XP reset in dev); history is preserved under the new id — expected until the runtime identity is rebound.

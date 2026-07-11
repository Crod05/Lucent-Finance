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

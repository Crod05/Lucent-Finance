---
name: Drizzle push in non-interactive shells
description: How to apply unique-constraint schema changes when drizzle-kit push demands a TTY prompt
---

Adding unique constraints to existing tables makes `drizzle-kit push` (even with `--force`) raise an interactive "truncate table?" prompt, which crashes with a TTY error in agent shells.

**Why:** drizzle-kit treats new unique constraints on populated tables as potentially destructive and requires interactive confirmation; `--force` does not bypass this particular prompt.

**How to apply:** First verify no duplicate rows exist (`GROUP BY ... HAVING count(*)>1`), then apply the DDL manually via `psql "$DATABASE_URL"` using the exact constraint names declared in the Drizzle schema, then run `pnpm --filter @workspace/db run push` to confirm "No changes detected".

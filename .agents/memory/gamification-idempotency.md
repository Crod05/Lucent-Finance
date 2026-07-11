---
name: Gamification idempotency & side-effect-free GETs
description: Rules for adding any new reward, mission, or challenge to Lucent Finance without double-awards or GET mutations.
---

**Rule:** Every reward must be one idempotent `xp_events` insert with a deterministic sourceId. GET handlers must never write — not even lazy row creation; use read-only accessors that return in-memory defaults when a row is missing.

**Why:** Lazy get-or-create in reads and completion-on-GET caused double-award and phantom-write bugs that a formal review flagged as blockers.

**How to apply:** New missions/challenges: make assignment a pure function of the date so reads can display without writing; materialize rows only inside action (POST/PATCH) routes with `onConflictDoNothing`; award XP in the same transaction as the claim. One-time writes (onboarding-style) use conditional UPDATE (`WHERE flag = false`) → 409 on repeat. Dev-only endpoints gate on `NODE_ENV` server-side and `import.meta.env.DEV` client-side.

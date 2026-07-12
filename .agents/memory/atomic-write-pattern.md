---
name: Atomic action-write pattern
description: How financial action routes keep DB writes atomic, and how rollback is tested via failpoints
---

**Rule:** every user action route that touches money + gamification opens exactly one `db.transaction` and passes `tx` to `*InTx` helpers only. Standalone helper wrappers (`awardXpForEvent`, `completeMissionIfPending`, etc.) open their own transaction — calling one inside a route transaction creates a nested savepoint and must be avoided.

**Why:** a crash between the financial write and the reward writes previously could persist a transaction/bill change without XP (or vice versa). Single-transaction scope guarantees all-or-nothing; the duplicate-409 and already-paid paths return sentinel objects from the tx callback and respond after commit.

**How to apply:** for any new action route, follow the pattern in `routes/transactions.ts`: sentinel-object returns from the tx callback, `failpoint("<route>.<point>")` markers inside the tx for rollback tests, and let errors propagate to the central error middleware (generic 500, `req.log.error`). Rollback tests compare full gamification snapshots (all xp/mission/bonus/achievement/progress rows) before vs after an injected failure — robust regardless of prior test state.

**Gotchas learned:** bill creation requires `frequency`; the XP amount column is `xpAmount` (`xp_amount`), not `amount`. Concurrent losers of a conditional UPDATE/insert block on the row/unique index until the winner commits, so the 409/already-paid paths still work with the longer transaction scope.

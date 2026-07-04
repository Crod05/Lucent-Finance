---
name: Behavioral OS (Lucent Finance gamification)
description: Design decisions behind the Financial Class, Daily Briefing, and onboarding gate features
---

# Behavioral OS — Phase 1 design decisions

## HYBRID Financial Class
The class chosen at onboarding is a **floor**, not fixed. Displayed class = `max(xpLadderIndex, chosenIndex)` (see `computeClassEvolution` in api-server `xp.ts`). The player evolves UP with XP but never drops below their chosen starting identity.
**Why:** users pick an aspirational/honest starting point at onboarding; XP should only ever promote, never demote, to keep the mechanic encouraging.

## Daily Mission Briefing — real-backed only
Bonus missions are restricted to action types with real evidence: `log_transaction` (transaction dated today) and `pay_bill` (xp_event `bill_paid` today). Missions that would require unimplemented tracking (categorize, recurring-bill detection, spending-rate) were deliberately deferred.
**Why:** never surface a mission the app cannot actually verify completion of — no fake/placeholder progress.

## Single-user model
`DEFAULT_USER = "default-user"` is hardcoded everywhere. "Replay character creation" in Settings calls the reset endpoint (clears profile fields + `onboardingCompleted`), it does NOT create a separate user. The App gate routes to onboarding whenever `!onboardingCompleted`.

## Weekly challenge window
Completed `daily_missions` in a rolling 7-day window must be bounded on BOTH ends (`gte(weekStart)` AND `lte(today)`), or future-dated rows leak into the count.

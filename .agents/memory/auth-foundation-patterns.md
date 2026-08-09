---
name: Auth foundation patterns (Session B-Alpha)
description: Durable rules for the Lucent auth layer — provider isolation, legacy claim gating, staged activation.
---

# Auth foundation rules (built in Session B-Alpha, 2026-08-09)

- **Provider isolation is test-enforced**: only the Clerk adapter file may import `@clerk/express` (a test walks `src/` and fails otherwise). Never add Clerk imports elsewhere; extend the `AuthProviderAdapter` interface instead. Use `clerkMiddleware()`+`getAuth()`, never `requireAuth()`.
- **Ownership identity is the internal users.id UUID only.** The Clerk subject is for identity resolution; it must never appear as an ownership FK or filter.
- **Legacy portfolio claim is fail-closed**: only the subject in env `LUCENT_LEGACY_OWNER_CLERK_SUBJECT` can claim the fixed legacy UUID, via a conditional single-row UPDATE requiring `migration_pending` + NULL subject. Missing/empty env → unclaimable (startup warning, server still starts). Never provision a fresh account silently for the designated legacy subject when the claim fails.
- **Auth is built but NOT mounted** in the default `createApp()` — production stays unauthenticated until B-Beta deliberately activates it at the documented point in app.ts. Do not mount it as a side effect of unrelated work.
- **Why:** the spec staged Session B into Alpha (foundation)/Beta (atomic activation + ownership cutover)/Gamma (schema hardening); mixing stages risks locking the user out of legacy data or breaking the running frontend.
- **How to apply:** any auth-related change should keep the adapter boundary, the fail-closed claim semantics, and the staged-activation discipline; tests enforce most of this — don't weaken them.

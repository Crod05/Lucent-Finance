---
name: Transaction semantics evaluator pattern
description: Facts-vs-policy design for transaction classification, and the fact-assembly completeness trap that overstates spending.
---

# Facts in DB, policy in one pure evaluator

Transactions store classification FACTS only (classification, status, confidence, source). All derived meaning (income/spending/budget amounts, gamification eligibility, review flags) comes from one pure, synchronous evaluator — never stored policy booleans, never DB access inside the evaluator.

**Why:** stored booleans drift from the facts they were derived from; a single evaluator keeps every consumer (budgets, Budget Guardian, gamification gate) consistent and testable without a DB.

**How to apply:** callers assemble a complete facts object (row + incoming/outgoing allocations with target facts) and pass it in. Any new consumer of transaction meaning must call the evaluator, not re-derive.

# Fact-assembly completeness trap

When assembling allocation facts for a scoped query (e.g. one month), you MUST load the transaction rows of EVERY allocation target the sources reference — not just targets inside the scope. A source split across in-scope and out-of-scope targets otherwise looks like it points at an "unclassified" phantom target; the evaluator flags it unresolved and zeroes ALL its effects, silently suppressing the legitimate in-scope offset and overstating spending.

**Why:** this exact bug shipped in the first Budget Guardian derived-spend implementation and passed the initial 25-test suite; only an architect review caught it. The evaluator's fail-closed design turns missing facts into wrongly-denied rewards.

**How to apply:** after loading allocations, collect all referenced target ids missing from the loaded map and fetch them before building evaluator inputs. Keep a split-allocation regression test whenever adding a new scoped fact-assembly site.

# Lucent Transaction Semantics Specification

This document defines Lucent Finance transaction semantics for financial calculations, budgets, insights, gamification evidence, and future systems such as quests, chapters, scorecards, and boss battles.

The goal is to keep the database focused on durable semantic facts and relationships while a centralized evaluator derives financial and gamification effects.

## Non-Negotiable Core Rules

- Transfers never create income or spending.
- Credit-card purchases are expenses; credit-card payments are transfers when correctly linked and classified.
- Loan proceeds are not income.
- Investment contributions are asset allocation, not consumption spending.
- Refunds reduce spending and never count as income.
- Reimbursements reduce the allocated personal expense and do not count as earned income.
- Unclassified and unresolved suggested transactions cannot support XP, quests, Budget Guardian, scorecards, boss battles, or chapter evidence.
- Confirmed classifications may become eligible according to evaluator policy.
- No ambiguous transaction may support financial-action evidence.
- The evaluator must prefer no reward over a false reward.

## Stored Facts vs Derived Policy Outputs

The database should store semantic facts and relationships. It must not store derived policy outputs that can become stale after reclassification or allocation changes.

The following values must never be stored as transaction-table columns:

- `counts_toward_budget`
- `counts_as_income`
- `counts_as_spending`
- `eligible_for_gamification`

These values must be derived exclusively by the centralized `evaluateTransactionSemantics` policy evaluator.

Storing these derived values would risk stale or contradictory state when a transaction is reclassified, linked to a transfer, allocated to a reimbursement, corrected, reversed, or otherwise updated. For example, a transaction originally classified as income might later be identified as a reimbursement; any stored `counts_as_income` flag would then become incorrect unless every dependent flag were updated perfectly.

The database stores what happened and how transactions relate. The evaluator derives what those facts mean for budgets, dashboards, insights, and gamification.

## Centralized Evaluator Contract

`evaluateTransactionSemantics` is the single source of truth for transaction meaning. It must be used by:

- Budgets
- Dashboard totals
- Spending insights
- Budget Guardian
- Quests
- Scorecards
- Chapters
- Future boss battles
- Any other financial-action evidence system

The evaluator must:

- Be pure and deterministic.
- Perform no database queries.
- Receive all required transaction and allocation facts as input.
- Return typed financial and evidence effects.
- Include `requiresReview`.
- Include machine-readable `reasonCodes`.
- Include a user-readable explanation.
- Avoid duplicating semantic rules in routes or feature-specific services.

Routes and feature services may orchestrate data loading and persistence, but they must not independently reimplement rules such as whether a refund counts as spending, whether a transfer is budget-eligible, or whether a transaction can support gamification.

## Classification Status and Evidence Eligibility

Transactions should carry explicit semantic facts such as classification, classification status, confidence, source, and relationships to other transactions.

A classification may be confirmed, suggested, unclassified, or otherwise represented by implementation-specific status values. The evaluator determines eligibility from those facts.

Rules:

- Confirmed classifications may be eligible for financial and gamification effects according to evaluator policy.
- Suggested or unresolved classifications require review when ambiguity could affect financial outcomes or rewards.
- Unclassified transactions cannot support XP, quests, Budget Guardian, scorecards, boss battles, chapter evidence, or other financial-action evidence.
- Ambiguous transactions must not support rewards or evidence until resolved.

## Transaction Relationships and Allocations

Lucent must support relationships and partial allocations between transactions. The normalized structure should be conceptually equivalent to `transaction_allocations`:

```ts
type TransactionAllocation = {
  id: number;
  source_transaction_id: number; // foreign key to transactions
  target_transaction_id: number; // foreign key to transactions
  relationship_type:
    | "refund_of"
    | "reimbursement_of"
    | "transfer_pair"
    | "reversal_of"
    | "correction_of";
  allocated_amount: number;
  created_at: string;
};
```

Supported relationship types:

- `refund_of`
- `reimbursement_of`
- `transfer_pair`
- `reversal_of`
- `correction_of`

Requirements:

- `allocated_amount` must be positive.
- A transaction cannot allocate to itself.
- Multiple refunds or reimbursements may relate to one original expense.
- One refund or reimbursement may be allocated across multiple applicable transactions.
- Total refund or reimbursement allocations must not silently exceed the relevant original amount.
- Transfer pairing must not create income or spending on either leg.
- Exact database constraints and transaction-safe validation will be finalized during implementation.

### Worked Example: Group Dinner Reimbursements

- Original group dinner expense: $300
- Friend A reimbursement: $100
- Friend B reimbursement: $120
- Net personal expense: $80

Two separate `reimbursement_of` allocations link the reimbursements to the original expense:

| Source Transaction | Target Transaction | Relationship | Allocated Amount |
| --- | --- | --- | --- |
| Friend A reimbursement | Group dinner expense | `reimbursement_of` | 100 |
| Friend B reimbursement | Group dinner expense | `reimbursement_of` | 120 |

The evaluator derives:

- Original gross expense: $300
- Reimbursement offsets: -$220
- Net personal expense: $80
- Earned income from reimbursements: $0

A single `related_transaction_id` is insufficient because it cannot model partial allocations, multiple reimbursements against one expense, one reimbursement split across several original expenses, or complex correction/reversal chains without losing allocation amounts and relationship types.

## Numeric Sign Convention

Evaluator outputs use explicit positive or negative financial effects. Ordinary expenses and income use positive amounts. Refunds, reimbursements, reversals, and applicable corrections may produce negative spending or budget effects. Refunds and reimbursements must never become earned income.

### $100 Expense

- `spendingAmount = 100`
- `budgetAmount = 100`
- `incomeAmount = 0`

### $100 Income

- `incomeAmount = 100`
- `spendingAmount = 0`
- `budgetAmount = 0`

### $100 Refund

- `spendingAmount = -100`
- `budgetAmount = -100`
- `incomeAmount = 0`

### $100 Allocated Reimbursement

- `spendingAmount = -100`
- `budgetAmount = -100`
- `incomeAmount = 0`

### Transfer

- `incomeAmount = 0`
- `spendingAmount = 0`
- `budgetAmount = 0`

This applies to both transfer legs.

## Net-Worth Impact

Net-worth impact must be represented as a discriminated union:

```ts
type NetWorthImpact =
  | {
      status: "known";
      amount: number;
    }
  | {
      status: "indeterminate";
      reason: string;
    };
```

Net-worth impact may be indeterminate when:

- Only one side of a transfer is tracked.
- A credit-card payment involves an untracked asset or liability.
- An investment transaction includes unresolved principal, gain, or loss.
- A debt transaction cannot confirm both asset and liability effects.
- The available transaction data is otherwise insufficient to determine the total economic effect.

Lucent must never manufacture false precision for net-worth calculations.

## Classification Rules by Transaction Family

### Ordinary Expenses

Ordinary purchases of goods or services are expenses. They generally produce positive `spendingAmount` and `budgetAmount` values when confirmed.

Examples:

- Groceries
- Rent
- Utilities
- Restaurant meals
- Credit-card purchases

### Ordinary Income

Earned or received income is income when confirmed. It produces positive `incomeAmount` and no spending or budget amount.

Examples:

- Salary
- Freelance payment
- Interest income, when classified as income

Refunds and reimbursements must not be classified as earned income merely because money entered an account.

### Transfers

Transfers move value between accounts owned or tracked by the user. They do not create income or spending.

Examples:

- Checking to savings transfer
- Credit-card payment when correctly linked and classified
- Brokerage contribution as asset allocation

Both transfer legs produce zero income, spending, and budget effects.

### Credit Cards

Credit-card purchases are expenses because they represent consumption or an acquired good/service.

Credit-card payments are transfers when correctly linked and classified because they move value from an asset account to reduce a liability. They do not create a second expense.

### Loans and Debt

Loan proceeds are not income. They increase cash while also increasing liability.

Debt payments may include principal, interest, and fees. Principal repayment is not consumption spending in the same way as an ordinary purchase. Interest and fees may be expenses depending on classification and evaluator policy.

If the transaction data cannot confirm both asset and liability effects, `netWorthImpact` may be indeterminate.

### Investments

Investment contributions are asset allocation, not consumption spending.

Investment transactions may require classification of principal, gain, loss, dividend, interest, or fees. If those components are unresolved, net-worth impact may be indeterminate and the transaction may require review.

### Refunds

Refunds reduce prior spending and budget impact. They never count as income.

A refund may be fully or partially allocated to one or more original expenses through `refund_of` allocations.

### Reimbursements

Reimbursements reduce the allocated personal expense. They do not count as earned income.

A reimbursement may be fully or partially allocated to one or more original expenses through `reimbursement_of` allocations.

### Reversals and Corrections

Reversals and corrections may produce negative spending, negative budget effects, or no effect depending on what they reverse or correct. They must be evaluated from confirmed facts and relationships rather than from broad route-level assumptions.

## Legacy Compatibility and Backfill

Existing valid user-created transactions with `type=income` or `type=expense` must be migrated as confirmed classifications:

- `classification_status = confirmed`
- `classification_confidence = high`
- `classification_source = legacy_type`

Mapping:

- Existing `type=income` maps to classification `income`.
- Existing `type=expense` maps to classification `expense`.
- Rows that cannot be safely mapped must become `unclassified`.

Legacy income and expense rows must not be marked merely `suggested`, because doing so could disable existing Budget Guardian, historical evidence, and gamification behavior.

New transactions created through the existing manual income and expense workflows must also receive compatible explicit classifications until a future classification UI replaces that behavior.

## Budget and Insight Effects

Budget calculations must consume evaluator outputs, not raw transaction `type` values or stored policy flags.

Rules:

- Confirmed expenses may increase budget usage.
- Confirmed refunds may reduce budget usage.
- Confirmed allocated reimbursements may reduce personal budget usage.
- Transfers must not affect budgets.
- Unclassified or review-required transactions must not support Budget Guardian or other reward evidence.

Spending insights must distinguish gross spending from net spending when the product surface requires it. Refunds and reimbursements should reduce net personal spending but must not appear as earned income.

## Gamification and Evidence Effects

Gamification systems must use evaluator results before awarding XP, achievements, quests, scorecards, chapters, boss battles, or Budget Guardian evidence.

Rules:

- Eligible evidence must come from confirmed, unambiguous semantic facts.
- Unclassified and unresolved suggested transactions cannot support XP, quests, Budget Guardian, scorecards, boss battles, or chapter evidence.
- Confirmed classifications may become eligible according to evaluator policy.
- No ambiguous transaction may support financial-action evidence.
- The evaluator must prefer no reward over a false reward.

`eligible_for_gamification` must not be stored as a transaction-table column. It is a derived evaluator output.

## Implementation Boundary

The implementation should separate three layers:

1. Stored facts: transaction fields, classifications, statuses, confidence, sources, account context, and allocation relationships.
2. Evaluator input assembly: database queries that gather the facts required for a transaction or transaction set.
3. Pure evaluation: `evaluateTransactionSemantics`, which receives facts and returns typed financial and evidence effects.

Feature routes and services must call the evaluator instead of duplicating semantic rules.

## Review Checklist

Before a transaction can support financial-action evidence, Lucent must be able to answer:

- Is the classification confirmed?
- Are all required relationships present?
- Are allocations valid and not over-applied?
- Is this income, spending, budget impact, transfer, refund, reimbursement, reversal, correction, or unresolved?
- Does the evaluator require user review?
- What reason codes explain the outcome?
- What explanation can be shown to the user?

If any answer is ambiguous, Lucent must not award evidence or rewards from that transaction.
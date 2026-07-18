/**
 * Centralized transaction semantics evaluator — the single source of truth
 * for what a transaction MEANS (see docs/transaction-semantics.md).
 *
 * Consumed by budgets, dashboard totals, spending insights, Budget Guardian,
 * and every current or future gamification evidence system (quests, chapters,
 * scorecards, boss battles). No route or feature service may reimplement
 * these rules.
 *
 * PURITY CONTRACT: this module is pure and deterministic. It performs no
 * database queries, imports no database modules, and is fully synchronous.
 * Callers assemble the required facts (transaction fields + allocation
 * relationships) and pass them in.
 *
 * Derived policy outputs (countsTowardBudget, countsAsIncome,
 * countsAsSpending, eligibleForGamification) exist ONLY as return values
 * here — they are never stored as database columns, because stored copies
 * would go stale the moment a transaction is reclassified or re-allocated.
 */

// Literal unions are declared locally (not imported from the DB package) so
// this module stays free of any database dependency.

export type TransactionClassification =
  | "expense"
  | "income"
  | "transfer"
  | "refund"
  | "reimbursement"
  | "investment_contribution"
  | "investment_withdrawal"
  | "debt_payment"
  | "debt_proceeds"
  | "fee_interest"
  | "adjustment"
  | "unclassified";

export type ClassificationStatus = "confirmed" | "suggested" | "unclassified";

export type AllocationRelationshipType =
  | "refund_of"
  | "reimbursement_of"
  | "transfer_pair"
  | "reversal_of"
  | "correction_of";

/** An allocation FROM this transaction TO another (this row is the source). */
export interface OutgoingAllocationFact {
  relationshipType: AllocationRelationshipType;
  allocatedAmount: number;
  targetTransactionId: number;
  targetClassification: TransactionClassification;
  targetClassificationStatus: ClassificationStatus;
}

/** An allocation FROM another transaction TO this one (this row is the target). */
export interface IncomingAllocationFact {
  relationshipType: AllocationRelationshipType;
  allocatedAmount: number;
  sourceTransactionId: number;
}

export interface TransactionFacts {
  id: number;
  /** Absolute transaction amount (always positive in storage). */
  amount: number;
  classification: TransactionClassification;
  classificationStatus: ClassificationStatus;
  outgoingAllocations?: OutgoingAllocationFact[];
  incomingAllocations?: IncomingAllocationFact[];
}

export type NetWorthImpact =
  | { status: "known"; amount: number }
  | { status: "indeterminate"; reason: string };

/**
 * Where a budget effect applies. `appliesToTransactionId === null` means the
 * effect applies to this transaction's own category/month (ordinary expense).
 * A non-null id means the effect applies wherever THAT transaction's budget
 * impact lives (refund/reimbursement offsets reduce the original expense's
 * budget, not the refund's own category).
 */
export interface BudgetImpact {
  appliesToTransactionId: number | null;
  amount: number;
}

export interface SemanticEffects {
  incomeAmount: number;
  spendingAmount: number;
  budgetAmount: number;
  /**
   * CONSERVATIVE savings policy: non-zero ONLY when the confirmed facts
   * establish a deliberate asset-allocation of cash toward savings —
   * currently just `investment_contribution`. Everything else (including
   * plain transfers, whose destination account type is unknown to the
   * evaluator) returns 0 rather than manufacturing a savings effect.
   */
  savingsAmount: number;
  budgetImpacts: BudgetImpact[];
  netWorthImpact: NetWorthImpact;
  /** May this transaction serve as Budget Guardian evidence? */
  guardianEligible: boolean;
  /** May this transaction serve as quest evidence? */
  questEvidenceEligible: boolean;
  /** May this transaction serve as chapter evidence? */
  chapterEvidenceEligible: boolean;
  /**
   * Convenience aggregate: true only when EVERY specific eligibility above
   * is true. Never a replacement for the specific fields — consumers that
   * care about one surface must read that surface's field.
   */
  eligibleForGamification: boolean;
  requiresReview: boolean;
  reasonCodes: string[];
  explanation: string;
}

/** Round to cents to avoid floating-point drift in derived sums. */
function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

const ZERO_EFFECTS = {
  incomeAmount: 0,
  spendingAmount: 0,
  budgetAmount: 0,
  savingsAmount: 0,
  budgetImpacts: [] as BudgetImpact[],
};

function blocked(
  netWorthImpact: NetWorthImpact,
  reasonCodes: string[],
  explanation: string,
): SemanticEffects {
  return {
    ...ZERO_EFFECTS,
    budgetImpacts: [],
    netWorthImpact,
    guardianEligible: false,
    questEvidenceEligible: false,
    chapterEvidenceEligible: false,
    eligibleForGamification: false,
    requiresReview: true,
    reasonCodes,
    explanation,
  };
}

/** Relationship types whose allocations offset a prior expense. */
const OFFSET_RELATIONSHIPS: Record<
  string,
  AllocationRelationshipType[] | undefined
> = {
  refund: ["refund_of"],
  reimbursement: ["reimbursement_of"],
  adjustment: ["reversal_of", "correction_of"],
};

/**
 * Evaluate a single transaction's financial and evidence effects from its
 * semantic facts. Pure, deterministic, synchronous — no I/O of any kind.
 *
 * Policy stance throughout: prefer NO reward over a FALSE reward. Anything
 * ambiguous produces zero effects, `requiresReview: true`, and
 * `eligibleForGamification: false`.
 */
export function evaluateTransactionSemantics(
  facts: TransactionFacts,
): SemanticEffects {
  const amount = r2(Math.abs(facts.amount));
  const outgoing = facts.outgoingAllocations ?? [];
  const incoming = facts.incomingAllocations ?? [];

  // --- Gate 1: classification status ---------------------------------------
  if (
    facts.classification === "unclassified" ||
    facts.classificationStatus === "unclassified"
  ) {
    return blocked(
      { status: "indeterminate", reason: "Transaction is unclassified." },
      ["UNCLASSIFIED"],
      "This transaction has not been classified, so it cannot affect budgets, income, spending, or rewards until it is.",
    );
  }
  if (facts.classificationStatus === "suggested") {
    return blocked(
      {
        status: "indeterminate",
        reason: "Suggested classification is unresolved.",
      },
      ["SUGGESTED_UNRESOLVED"],
      "This transaction has a suggested classification awaiting confirmation; it cannot affect financial totals or rewards until resolved.",
    );
  }

  // --- Gate 2: confirmed — evaluate per classification family --------------
  const hasTransferPair =
    outgoing.some((a) => a.relationshipType === "transfer_pair") ||
    incoming.some((a) => a.relationshipType === "transfer_pair");

  const ok = (
    partial: Partial<SemanticEffects> & { netWorthImpact: NetWorthImpact },
    explanation: string,
    reasonCodes: string[] = [],
  ): SemanticEffects => ({
    ...ZERO_EFFECTS,
    budgetImpacts: [],
    guardianEligible: true,
    questEvidenceEligible: true,
    chapterEvidenceEligible: true,
    eligibleForGamification: true,
    requiresReview: false,
    reasonCodes,
    explanation,
    ...partial,
  });

  switch (facts.classification) {
    case "expense":
      return ok(
        {
          spendingAmount: amount,
          budgetAmount: amount,
          budgetImpacts: [{ appliesToTransactionId: null, amount }],
          netWorthImpact: { status: "known", amount: -amount },
        },
        "Confirmed expense: counts as spending and toward its budget category.",
        ["CONFIRMED_EXPENSE"],
      );

    case "income":
      return ok(
        {
          incomeAmount: amount,
          netWorthImpact: { status: "known", amount },
        },
        "Confirmed income: counts as earned income; no spending or budget impact.",
        ["CONFIRMED_INCOME"],
      );

    case "transfer":
      return ok(
        {
          netWorthImpact: hasTransferPair
            ? { status: "known", amount: 0 }
            : {
                status: "indeterminate",
                reason:
                  "Only one side of the transfer is tracked; the other account is not confirmed.",
              },
        },
        "Transfer between owned accounts: never income, never spending, never budget impact.",
        ["TRANSFER_NEUTRAL"],
      );

    case "fee_interest":
      return ok(
        {
          spendingAmount: amount,
          budgetAmount: amount,
          budgetImpacts: [{ appliesToTransactionId: null, amount }],
          netWorthImpact: { status: "known", amount: -amount },
        },
        "Confirmed fee or interest charge: counts as spending and toward its budget category.",
        ["CONFIRMED_FEE_INTEREST"],
      );

    case "investment_contribution":
      return ok(
        {
          savingsAmount: amount,
          netWorthImpact: hasTransferPair
            ? { status: "known", amount: 0 }
            : {
                status: "indeterminate",
                reason:
                  "Asset allocation: the receiving investment account's value is not tracked here.",
              },
        },
        "Investment contribution: asset allocation, not consumption spending; no income or budget impact.",
        ["INVESTMENT_ALLOCATION"],
      );

    case "investment_withdrawal":
      return blocked(
        {
          status: "indeterminate",
          reason:
            "Withdrawal mixes principal, gains, and losses that are not resolved.",
        },
        ["INVESTMENT_COMPONENTS_UNRESOLVED"],
        "Investment withdrawal with unresolved principal/gain/loss components: needs review before it can affect totals or rewards.",
      );

    case "debt_payment":
      return ok(
        {
          netWorthImpact: hasTransferPair
            ? { status: "known", amount: 0 }
            : {
                status: "indeterminate",
                reason:
                  "The liability side of this debt payment is not confirmed.",
              },
        },
        "Debt payment: principal repayment is not consumption spending; interest/fee components are not itemized, so no budget impact is derived.",
        ["DEBT_PAYMENT_NEUTRAL"],
      );

    case "debt_proceeds":
      return ok(
        {
          netWorthImpact: {
            status: "indeterminate",
            reason:
              "Loan proceeds increase cash and liability together; the liability side is not confirmed.",
          },
        },
        "Loan proceeds: never income — cash increased but so did a liability.",
        ["DEBT_PROCEEDS_NOT_INCOME"],
      );

    case "refund":
    case "reimbursement":
    case "adjustment": {
      const allowed = OFFSET_RELATIONSHIPS[facts.classification]!;
      const offsets = outgoing.filter((a) =>
        allowed.includes(a.relationshipType),
      );
      const label =
        facts.classification === "adjustment"
          ? "reversal/correction"
          : facts.classification;

      if (offsets.length === 0) {
        return blocked(
          {
            status: "indeterminate",
            reason: `Un-allocated ${label}: the original transaction it offsets is unknown.`,
          },
          [`${facts.classification.toUpperCase()}_UNALLOCATED`],
          `This ${label} is not yet allocated to any original transaction; it cannot reduce spending (and never counts as income) until it is.`,
        );
      }

      const allocatedSum = r2(
        offsets.reduce((s, a) => s + r2(Math.abs(a.allocatedAmount)), 0),
      );
      if (allocatedSum > amount + 0.005) {
        return blocked(
          {
            status: "indeterminate",
            reason: "Allocations exceed the transaction amount.",
          },
          ["OVER_ALLOCATED"],
          `This ${label} has ${allocatedSum} allocated against an amount of ${amount}; over-allocation must be corrected before any effect is derived.`,
        );
      }

      const unresolvedTargets = offsets.filter(
        (a) =>
          a.targetClassificationStatus !== "confirmed" ||
          !["expense", "fee_interest"].includes(a.targetClassification),
      );
      if (unresolvedTargets.length > 0) {
        return blocked(
          {
            status: "indeterminate",
            reason:
              "One or more allocation targets are not confirmed expenses.",
          },
          ["ALLOCATION_TARGET_UNRESOLVED"],
          `This ${label} is allocated to a transaction that is not a confirmed expense; resolve the target before effects are derived.`,
        );
      }

      return ok(
        {
          spendingAmount: -allocatedSum,
          budgetAmount: -allocatedSum,
          budgetImpacts: offsets.map((a) => ({
            appliesToTransactionId: a.targetTransactionId,
            amount: -r2(Math.abs(a.allocatedAmount)),
          })),
          netWorthImpact:
            facts.classification === "adjustment"
              ? {
                  status: "indeterminate",
                  reason:
                    "Adjustment net-worth effect depends on what it corrects.",
                }
              : { status: "known", amount },
        },
        `Allocated ${label}: reduces the original expense's spending and budget impact by ${allocatedSum}; never counts as earned income.`,
        [
          facts.classification === "refund"
            ? "REFUND_REDUCES_SPENDING"
            : facts.classification === "reimbursement"
              ? "REIMBURSEMENT_REDUCES_ALLOCATED_SPENDING"
              : "ADJUSTMENT_OFFSETS_TARGET",
        ],
      );
    }
  }
}

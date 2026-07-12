import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  transactionsTable,
  transactionAllocationsTable,
  ALLOCATION_RELATIONSHIP_TYPES,
  type AllocationRelationshipType,
  type TransactionAllocation,
} from "@workspace/db";
import type { DbTx } from "./xp";

/**
 * Transaction-safe creation of transaction_allocations rows
 * (see docs/transaction-semantics.md).
 *
 * The database enforces row-level facts (positive amount, no self-allocation,
 * valid relationship type, FK integrity). Aggregate rules — allocations must
 * not silently exceed the source's own amount or the target's original
 * amount — cannot be row-level CHECKs, so they are enforced here inside the
 * caller's transaction with FOR UPDATE row locks: concurrent allocators
 * against the same rows serialize, and the loser re-reads a sum that already
 * includes the winner's row.
 */

export class AllocationError extends Error {
  constructor(
    public readonly code:
      | "SOURCE_NOT_FOUND"
      | "TARGET_NOT_FOUND"
      | "SELF_ALLOCATION"
      | "NON_POSITIVE_AMOUNT"
      | "INVALID_RELATIONSHIP_TYPE"
      | "SOURCE_OVER_ALLOCATED"
      | "TARGET_OVER_ALLOCATED",
    message: string,
  ) {
    super(message);
    this.name = "AllocationError";
  }
}

export interface CreateAllocationInput {
  sourceTransactionId: number;
  targetTransactionId: number;
  relationshipType: AllocationRelationshipType;
  allocatedAmount: number;
}

/** Cent-rounded sum of allocation amounts. */
function sumAmounts(rows: { allocatedAmount: string }[]): number {
  return (
    Math.round(rows.reduce((s, r) => s + Number(r.allocatedAmount) * 100, 0)) /
    100
  );
}

export async function createAllocationInTx(
  tx: DbTx,
  input: CreateAllocationInput,
): Promise<TransactionAllocation> {
  const { sourceTransactionId, targetTransactionId, relationshipType } = input;
  const allocatedAmount = Math.round(input.allocatedAmount * 100) / 100;

  if (!(allocatedAmount > 0)) {
    throw new AllocationError(
      "NON_POSITIVE_AMOUNT",
      "allocated_amount must be positive.",
    );
  }
  if (sourceTransactionId === targetTransactionId) {
    throw new AllocationError(
      "SELF_ALLOCATION",
      "A transaction cannot allocate to itself.",
    );
  }
  if (!ALLOCATION_RELATIONSHIP_TYPES.includes(relationshipType)) {
    throw new AllocationError(
      "INVALID_RELATIONSHIP_TYPE",
      `Unknown relationship type: ${relationshipType}`,
    );
  }

  // Lock both transaction rows in deterministic (id) order to avoid
  // deadlocks between concurrent allocators.
  const ids = [sourceTransactionId, targetTransactionId].sort((a, b) => a - b);
  const lockedRows = await tx
    .select({ id: transactionsTable.id, amount: transactionsTable.amount })
    .from(transactionsTable)
    .where(inArray(transactionsTable.id, ids))
    .orderBy(transactionsTable.id)
    .for("update");

  const source = lockedRows.find((r) => r.id === sourceTransactionId);
  const target = lockedRows.find((r) => r.id === targetTransactionId);
  if (!source) {
    throw new AllocationError(
      "SOURCE_NOT_FOUND",
      `Source transaction ${sourceTransactionId} does not exist.`,
    );
  }
  if (!target) {
    throw new AllocationError(
      "TARGET_NOT_FOUND",
      `Target transaction ${targetTransactionId} does not exist.`,
    );
  }

  // A source (e.g. one reimbursement) may split across several targets, but
  // the total it hands out can never exceed its own amount.
  const outgoing = await tx
    .select({ allocatedAmount: transactionAllocationsTable.allocatedAmount })
    .from(transactionAllocationsTable)
    .where(
      eq(transactionAllocationsTable.sourceTransactionId, sourceTransactionId),
    );
  const sourceTotal = sumAmounts(outgoing) + allocatedAmount;
  if (sourceTotal > Number(source.amount) + 0.005) {
    throw new AllocationError(
      "SOURCE_OVER_ALLOCATED",
      `Allocating ${allocatedAmount} would put total allocations from transaction ${sourceTransactionId} at ${sourceTotal}, exceeding its amount of ${source.amount}.`,
    );
  }

  // A target (e.g. one group-dinner expense) may receive several refunds or
  // reimbursements, but their total can never exceed the original amount.
  const incoming = await tx
    .select({ allocatedAmount: transactionAllocationsTable.allocatedAmount })
    .from(transactionAllocationsTable)
    .where(
      eq(transactionAllocationsTable.targetTransactionId, targetTransactionId),
    );
  const targetTotal = sumAmounts(incoming) + allocatedAmount;
  if (targetTotal > Number(target.amount) + 0.005) {
    throw new AllocationError(
      "TARGET_OVER_ALLOCATED",
      `Allocating ${allocatedAmount} would put total allocations against transaction ${targetTransactionId} at ${targetTotal}, exceeding its original amount of ${target.amount}.`,
    );
  }

  const [row] = await tx
    .insert(transactionAllocationsTable)
    .values({
      sourceTransactionId,
      targetTransactionId,
      relationshipType,
      allocatedAmount: allocatedAmount.toFixed(2),
    })
    .returning();
  return row;
}

/** Standalone wrapper: opens a transaction and delegates to the InTx form. */
export async function createAllocation(
  input: CreateAllocationInput,
): Promise<TransactionAllocation> {
  return await db.transaction(async (tx) => createAllocationInTx(tx, input));
}

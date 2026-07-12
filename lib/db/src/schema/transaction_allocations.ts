import { pgTable, serial, timestamp, numeric, integer, text, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { transactionsTable } from "./transactions";

// ---------------------------------------------------------------------------
// Normalized transaction relationships with partial allocations
// (see docs/transaction-semantics.md). A single related_transaction_id is
// insufficient: one reimbursement can split across several expenses, several
// reimbursements can target one expense, and each link carries an allocated
// amount and a relationship type.
//
// DB-level constraints: positive amount, no self-allocation, valid
// relationship type. Over-allocation (allocations exceeding the original
// amount) cannot be expressed as a row-level CHECK; it is enforced
// transaction-safely by createAllocationInTx in the API server, which locks
// the target row before summing.
// ---------------------------------------------------------------------------

export const ALLOCATION_RELATIONSHIP_TYPES = [
  "refund_of",
  "reimbursement_of",
  "transfer_pair",
  "reversal_of",
  "correction_of",
] as const;
export type AllocationRelationshipType = (typeof ALLOCATION_RELATIONSHIP_TYPES)[number];

export const transactionAllocationsTable = pgTable(
  "transaction_allocations",
  {
    id: serial("id").primaryKey(),
    sourceTransactionId: integer("source_transaction_id")
      .notNull()
      .references(() => transactionsTable.id, { onDelete: "cascade" }),
    targetTransactionId: integer("target_transaction_id")
      .notNull()
      .references(() => transactionsTable.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    allocatedAmount: numeric("allocated_amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transaction_allocations_source_idx").on(t.sourceTransactionId),
    index("transaction_allocations_target_idx").on(t.targetTransactionId),
    check("transaction_allocations_positive_amount", sql`${t.allocatedAmount} > 0`),
    check(
      "transaction_allocations_no_self",
      sql`${t.sourceTransactionId} <> ${t.targetTransactionId}`,
    ),
    check(
      "transaction_allocations_relationship_type_check",
      sql`${t.relationshipType} IN (${sql.raw(
        ALLOCATION_RELATIONSHIP_TYPES.map((v) => `'${v}'`).join(", "),
      )})`,
    ),
  ],
);

export type TransactionAllocation = typeof transactionAllocationsTable.$inferSelect;
export type InsertTransactionAllocation = typeof transactionAllocationsTable.$inferInsert;

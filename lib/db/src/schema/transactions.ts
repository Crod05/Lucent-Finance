import { pgTable, text, serial, timestamp, numeric, integer, date, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Semantic classification vocabulary (see docs/transaction-semantics.md).
// The database stores semantic FACTS only. Derived policy outputs
// (counts_toward_budget, counts_as_income, counts_as_spending,
// eligible_for_gamification) are NEVER stored as columns — they are derived
// exclusively by the centralized evaluateTransactionSemantics evaluator.
// ---------------------------------------------------------------------------

export const TRANSACTION_CLASSIFICATIONS = [
  "expense",
  "income",
  "transfer",
  "refund",
  "reimbursement",
  "investment_contribution",
  "investment_withdrawal",
  "debt_payment",
  "debt_proceeds",
  "fee_interest",
  "adjustment",
  "unclassified",
] as const;
export type TransactionClassification = (typeof TRANSACTION_CLASSIFICATIONS)[number];

export const CLASSIFICATION_STATUSES = ["confirmed", "suggested", "unclassified"] as const;
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];

export const CLASSIFICATION_CONFIDENCES = ["high", "medium", "low", "none"] as const;
export type ClassificationConfidence = (typeof CLASSIFICATION_CONFIDENCES)[number];

export const CLASSIFICATION_SOURCES = [
  "user",
  "legacy_type",
  "rule",
  "institution",
  "linked_transaction",
  "unknown",
] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

export const transactionsTable = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    category: text("category").notNull(),
    type: text("type").notNull(), // 'income' | 'expense'
    accountId: integer("account_id"),
    notes: text("notes"),
    fingerprint: text("fingerprint"),
    // Semantic classification facts. Defaults represent "we know nothing":
    // unclassified rows can never support budgets, XP, or evidence.
    classification: text("classification").notNull().default("unclassified"),
    classificationStatus: text("classification_status").notNull().default("unclassified"),
    classificationConfidence: text("classification_confidence").notNull().default("none"),
    classificationSource: text("classification_source").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Enforces dedup at the database level: two rows can never share a
    // non-null fingerprint, even under concurrent inserts. NULL fingerprints
    // (pre-fingerprint legacy rows) are exempt via the partial index.
    uniqueIndex("transactions_fingerprint_unique")
      .on(t.fingerprint)
      .where(sql`${t.fingerprint} IS NOT NULL`),
    check(
      "transactions_classification_check",
      sql`${t.classification} IN (${inList(TRANSACTION_CLASSIFICATIONS)})`,
    ),
    check(
      "transactions_classification_status_check",
      sql`${t.classificationStatus} IN (${inList(CLASSIFICATION_STATUSES)})`,
    ),
    check(
      "transactions_classification_confidence_check",
      sql`${t.classificationConfidence} IN (${inList(CLASSIFICATION_CONFIDENCES)})`,
    ),
    check(
      "transactions_classification_source_check",
      sql`${t.classificationSource} IN (${inList(CLASSIFICATION_SOURCES)})`,
    ),
  ]
);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true, fingerprint: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;

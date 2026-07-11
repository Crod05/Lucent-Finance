import { pgTable, text, serial, timestamp, numeric, integer, date, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Enforces dedup at the database level: two rows can never share a
    // non-null fingerprint, even under concurrent inserts. NULL fingerprints
    // (pre-fingerprint legacy rows) are exempt via the partial index.
    uniqueIndex("transactions_fingerprint_unique")
      .on(t.fingerprint)
      .where(sql`${t.fingerprint} IS NOT NULL`),
  ]
);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true, fingerprint: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;

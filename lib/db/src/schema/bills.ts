import { pgTable, text, serial, timestamp, numeric, date, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const billsTable = pgTable(
  "bills",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    frequency: text("frequency").notNull(), // weekly|monthly|quarterly|yearly|once
    category: text("category").notNull(),
    status: text("status").notNull().default("unpaid"), // paid|unpaid|overdue
    notes: text("notes"),
    // Session A: nullable ownership column (see accounts.ts for the plan).
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bills_user_id_due_date_idx").on(t.userId, t.dueDate)],
);

export const insertBillSchema = createInsertSchema(billsTable).omit({ id: true, createdAt: true, userId: true });
export type InsertBill = z.infer<typeof insertBillSchema>;
export type Bill = typeof billsTable.$inferSelect;

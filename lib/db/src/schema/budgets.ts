import { pgTable, text, serial, timestamp, numeric, integer, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const budgetsTable = pgTable(
  "budgets",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(),
    monthlyLimit: numeric("monthly_limit", { precision: 12, scale: 2 }).notNull(),
    currentSpent: numeric("current_spent", { precision: 12, scale: 2 }).notNull().default("0"),
    month: integer("month").notNull(),
    year: integer("year").notNull(),
    // Session A: nullable ownership column (see accounts.ts for the plan).
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("budgets_user_id_year_month_idx").on(t.userId, t.year, t.month)],
);

export const insertBudgetSchema = createInsertSchema(budgetsTable).omit({ id: true, createdAt: true, userId: true });
export type InsertBudget = z.infer<typeof insertBudgetSchema>;
export type Budget = typeof budgetsTable.$inferSelect;

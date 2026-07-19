import { pgTable, text, serial, timestamp, numeric, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const accountsTable = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(), // checking|savings|credit|investment|other
    balance: numeric("balance", { precision: 12, scale: 2 }).notNull(),
    institution: text("institution").notNull(),
    notes: text("notes"),
    // Session A: nullable ownership column, backfilled for existing rows.
    // Becomes NOT NULL in Session B once all writers supply the authenticated
    // internal userId. No default — an ownerless insert must stay visible.
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true, userId: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;

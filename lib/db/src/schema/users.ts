import { pgTable, text, timestamp, uuid, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Internal Lucent user identity (Session A foundation).
//
// The internal UUID `id` is the authoritative ownership key for all Lucent
// data. External auth-provider identifiers (e.g. the Clerk userId) live ONLY
// in this table as (auth_provider, auth_provider_subject); they must never be
// used as an ownership foreign key elsewhere. Email is informational only —
// never an identity or ownership key.
//
// `auth_provider_subject` is nullable ONLY for the `migration_pending` legacy
// owner row created by migration 0003; Session B's controlled bootstrap
// attaches the verified provider subject and flips status to `active`.
//
// NO authentication is implemented yet. This table is a data foundation only.
// ---------------------------------------------------------------------------

export const USER_STATUSES = ["active", "disabled", "migration_pending"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authProvider: text("auth_provider").notNull(), // 'clerk' initially
    authProviderSubject: text("auth_provider_subject"), // NULL only while status='migration_pending'
    email: text("email"), // nullable, informational; NEVER an ownership key
    displayName: text("display_name"),
    timezone: text("timezone"), // nullable placeholder; timezone support is a later phase
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("users_provider_subject_unique").on(t.authProvider, t.authProviderSubject),
    check("users_status_check", sql`${t.status} IN ('active', 'disabled', 'migration_pending')`),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

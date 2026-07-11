import { pgTable, text, serial, integer, date, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Persistent per-date bonus-mission state. The day's bonus assignment is a
 * deterministic function of the date (see api-server xp lib), so a row is
 * only written when the assigned underlying action actually occurs — the row
 * records slot, type, reward, completion status, timestamp, and the evidence
 * (transaction fingerprint / bill id) that backed it. unique(userId, date)
 * guarantees at most one bonus completion per player per day.
 */
export const bonusMissionsTable = pgTable(
  "bonus_missions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().default("default-user"),
    date: date("date", { mode: "string" }).notNull(),
    slot: text("slot").notNull().default("bonus"),
    missionType: text("mission_type").notNull(),
    xpReward: integer("xp_reward").notNull().default(15),
    status: text("status").notNull().default("completed"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    evidenceRef: text("evidence_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("bonus_missions_user_date_unique").on(t.userId, t.date)]
);

export const insertBonusMissionSchema = createInsertSchema(bonusMissionsTable).omit({ id: true, createdAt: true });
export type InsertBonusMission = z.infer<typeof insertBonusMissionSchema>;
export type BonusMission = typeof bonusMissionsTable.$inferSelect;

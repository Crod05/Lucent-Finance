import { pgTable, text, serial, integer, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailyMissionsTable = pgTable("daily_missions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().default("default-user"),
  date: date("date", { mode: "string" }).notNull(),
  missionType: text("mission_type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  xpReward: integer("xp_reward").notNull().default(25),
  status: text("status").notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDailyMissionSchema = createInsertSchema(dailyMissionsTable).omit({ id: true, createdAt: true });
export type InsertDailyMission = z.infer<typeof insertDailyMissionSchema>;
export type DailyMission = typeof dailyMissionsTable.$inferSelect;

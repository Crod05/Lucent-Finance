import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const earnedAchievementsTable = pgTable("earned_achievements", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().default("default-user"),
  badgeKey: text("badge_key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEarnedAchievementSchema = createInsertSchema(earnedAchievementsTable).omit({ id: true, earnedAt: true });
export type InsertEarnedAchievement = z.infer<typeof insertEarnedAchievementSchema>;
export type EarnedAchievement = typeof earnedAchievementsTable.$inferSelect;

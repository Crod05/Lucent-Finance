import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const xpEventsTable = pgTable(
  "xp_events",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().default("default-user"),
    eventType: text("event_type").notNull(),
    sourceId: text("source_id").notNull(),
    xpAmount: integer("xp_amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("xp_events_user_event_source_unique").on(t.userId, t.eventType, t.sourceId)]
);

export const insertXpEventSchema = createInsertSchema(xpEventsTable).omit({ id: true, createdAt: true });
export type InsertXpEvent = z.infer<typeof insertXpEventSchema>;
export type XpEventRow = typeof xpEventsTable.$inferSelect;

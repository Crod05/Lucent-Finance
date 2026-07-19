CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "auth_provider" text NOT NULL,
        "auth_provider_subject" text,
        "email" text,
        "display_name" text,
        "timezone" text,
        "status" text DEFAULT 'active' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "users_provider_subject_unique" UNIQUE("auth_provider","auth_provider_subject"),
        CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('active', 'disabled', 'migration_pending'))
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_user_id_date_idx" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "budgets_user_id_year_month_idx" ON "budgets" USING btree ("user_id","year","month");--> statement-breakpoint
CREATE INDEX "bills_user_id_due_date_idx" ON "bills" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Session A backfill (hand-authored; deterministic and reviewable).
--
-- All pre-authentication data belongs to one legacy Lucent owner. That owner
-- is represented by a single migration-created user row with a FIXED,
-- documented UUID used ONLY for this legacy owner record:
--
--   00000000-0000-4000-8000-000000000001
--
-- Rationale for a fixed UUID: the checked-in migration must be deterministic
-- (same result on every database it is applied to) and every backfill
-- statement below must reference the same owner id. ON CONFLICT (id) DO
-- NOTHING guarantees exactly one owner row even if the statement is ever
-- re-executed. The row is created with status='migration_pending' and a NULL
-- auth_provider_subject; Session B's controlled bootstrap (deployment-secret
-- match) attaches the verified provider subject and flips status to 'active'.
-- No personal identity data is invented: email/display_name/timezone are NULL.
-- ---------------------------------------------------------------------------
INSERT INTO "users" ("id", "auth_provider", "auth_provider_subject", "email", "display_name", "timezone", "status")
VALUES ('00000000-0000-4000-8000-000000000001', 'clerk', NULL, NULL, NULL, NULL, 'migration_pending')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Backfill financial root tables: every pre-existing (ownerless) row belongs
-- to the legacy owner. New rows created after this migration may still have
-- NULL user_id until Session B propagates the authenticated userId — the
-- columns intentionally stay nullable and have NO default.
UPDATE "accounts" SET "user_id" = '00000000-0000-4000-8000-000000000001' WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "transactions" SET "user_id" = '00000000-0000-4000-8000-000000000001' WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "budgets" SET "user_id" = '00000000-0000-4000-8000-000000000001' WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "bills" SET "user_id" = '00000000-0000-4000-8000-000000000001' WHERE "user_id" IS NULL;
-- ---------------------------------------------------------------------------
-- GAMIFICATION TABLES ARE DELIBERATELY NOT TOUCHED IN SESSION A.
--
-- user_progress / daily_missions / bonus_missions / earned_achievements /
-- xp_events keep their text user_id columns, their DEFAULT 'default-user',
-- and their existing 'default-user' rows. The production runtime still reads
-- and writes through DEFAULT_USER = 'default-user'; relabeling those rows
-- here would make all existing XP / achievement / mission history invisible
-- to the current runtime (a visible behavior regression).
--
-- Session B migrates gamification ownership atomically with: removal of both
-- DEFAULT_USER constants, propagation of the authenticated internal userId,
-- conversion of gamification user_id from text to uuid with FKs to users,
-- updates to every gamification reader/writer, and verification that all
-- existing history remains visible through the migrated owner.
-- ---------------------------------------------------------------------------

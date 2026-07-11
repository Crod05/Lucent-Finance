CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"account_id" integer,
	"notes" text,
	"fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"monthly_limit" numeric(12, 2) NOT NULL,
	"current_spent" numeric(12, 2) DEFAULT '0' NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"due_date" date NOT NULL,
	"frequency" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"balance" numeric(12, 2) NOT NULL,
	"institution" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT 'default-user' NOT NULL,
	"total_xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_mission_date" date,
	"name" text,
	"spawn_point" text,
	"financial_class" text,
	"primary_financial_concern" text,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_progress_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "daily_missions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT 'default-user' NOT NULL,
	"date" date NOT NULL,
	"mission_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"xp_reward" integer DEFAULT 25 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_missions_user_date_unique" UNIQUE("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "bonus_missions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT 'default-user' NOT NULL,
	"date" date NOT NULL,
	"slot" text DEFAULT 'bonus' NOT NULL,
	"mission_type" text NOT NULL,
	"xp_reward" integer DEFAULT 15 NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"completed_at" timestamp with time zone,
	"evidence_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bonus_missions_user_date_unique" UNIQUE("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "earned_achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT 'default-user' NOT NULL,
	"badge_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "earned_achievements_user_badge_unique" UNIQUE("user_id","badge_key")
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT 'default-user' NOT NULL,
	"event_type" text NOT NULL,
	"source_id" text NOT NULL,
	"xp_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_events_user_event_source_unique" UNIQUE("user_id","event_type","source_id")
);

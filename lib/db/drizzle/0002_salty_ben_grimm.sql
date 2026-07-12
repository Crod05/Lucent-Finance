CREATE TABLE "transaction_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_transaction_id" integer NOT NULL,
	"target_transaction_id" integer NOT NULL,
	"relationship_type" text NOT NULL,
	"allocated_amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_allocations_positive_amount" CHECK ("transaction_allocations"."allocated_amount" > 0),
	CONSTRAINT "transaction_allocations_no_self" CHECK ("transaction_allocations"."source_transaction_id" <> "transaction_allocations"."target_transaction_id"),
	CONSTRAINT "transaction_allocations_relationship_type_check" CHECK ("transaction_allocations"."relationship_type" IN ('refund_of', 'reimbursement_of', 'transfer_pair', 'reversal_of', 'correction_of'))
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "classification" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "classification_status" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "classification_confidence" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "classification_source" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_allocations" ADD CONSTRAINT "transaction_allocations_source_transaction_id_transactions_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_allocations" ADD CONSTRAINT "transaction_allocations_target_transaction_id_transactions_id_fk" FOREIGN KEY ("target_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_allocations_source_idx" ON "transaction_allocations" USING btree ("source_transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_allocations_target_idx" ON "transaction_allocations" USING btree ("target_transaction_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_classification_check" CHECK ("transactions"."classification" IN ('expense', 'income', 'transfer', 'refund', 'reimbursement', 'investment_contribution', 'investment_withdrawal', 'debt_payment', 'debt_proceeds', 'fee_interest', 'adjustment', 'unclassified'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_classification_status_check" CHECK ("transactions"."classification_status" IN ('confirmed', 'suggested', 'unclassified'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_classification_confidence_check" CHECK ("transactions"."classification_confidence" IN ('high', 'medium', 'low', 'none'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_classification_source_check" CHECK ("transactions"."classification_source" IN ('user', 'legacy_type', 'rule', 'institution', 'linked_transaction', 'unknown'));--> statement-breakpoint
UPDATE "transactions"
SET "classification" = "type",
    "classification_status" = 'confirmed',
    "classification_confidence" = 'high',
    "classification_source" = 'legacy_type'
WHERE "type" IN ('income', 'expense')
  AND "classification_status" = 'unclassified';

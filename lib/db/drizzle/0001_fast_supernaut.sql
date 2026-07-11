-- Deterministic duplicate cleanup before enforcing uniqueness.
-- Strategy: for each group of rows sharing the same non-null fingerprint,
-- keep the row with the LOWEST id (the earliest-created row) and delete the
-- rest. This is deterministic and re-runnable. Deleted rows are true
-- duplicates by definition of the fingerprint (same date, normalized
-- description, amount, type, and account).
-- Inspection of the live database on 2026-07-11 found ZERO duplicate
-- non-null fingerprints, so on that data this DELETE is a no-op; it is kept
-- so the migration is safe against any database state.
DELETE FROM "transactions" t
USING "transactions" d
WHERE t."fingerprint" IS NOT NULL
  AND d."fingerprint" = t."fingerprint"
  AND d."id" < t."id";
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_fingerprint_unique" ON "transactions" USING btree ("fingerprint") WHERE "transactions"."fingerprint" IS NOT NULL;

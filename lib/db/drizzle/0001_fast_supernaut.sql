-- Deterministic duplicate cleanup before enforcing uniqueness.
-- Strategy: for each group of rows sharing the same non-null fingerprint,
-- keep the row with the LOWEST id (the earliest-created row) and delete the
-- rest. This is deterministic and re-runnable. Deleted rows are true
-- duplicates by definition of the fingerprint (same date, normalized
-- description, amount, type, and account).
-- Inspection of the live database on 2026-07-11 found ZERO duplicate
-- non-null fingerprints, so on that data this DELETE is a no-op; it is kept
-- so the migration is safe against any database state.
--
-- Before deleting duplicates, remap any bonus_missions evidence reference
-- ("transaction:<id>") that points at a soon-to-be-deleted duplicate onto the
-- surviving lowest-id transaction of the SAME fingerprint group, so no bonus
-- mission is left referencing a deleted row. (Audit on 2026-07-11 found zero
-- transaction evidence references in the live database, so this too is a
-- no-op on that data; it protects any other database state.)
UPDATE "bonus_missions" bm
SET "evidence_ref" = 'transaction:' || s."survivor_id"::text
FROM (
  SELECT t."id" AS dup_id, g."survivor_id"
  FROM "transactions" t
  JOIN (
    SELECT "fingerprint", MIN("id") AS survivor_id
    FROM "transactions"
    WHERE "fingerprint" IS NOT NULL
    GROUP BY "fingerprint"
  ) g ON g."fingerprint" = t."fingerprint"
  WHERE t."id" <> g."survivor_id"
) s
WHERE bm."evidence_ref" = 'transaction:' || s."dup_id"::text;
--> statement-breakpoint
DELETE FROM "transactions" t
USING "transactions" d
WHERE t."fingerprint" IS NOT NULL
  AND d."fingerprint" = t."fingerprint"
  AND d."id" < t."id";
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_fingerprint_unique" ON "transactions" USING btree ("fingerprint") WHERE "transactions"."fingerprint" IS NOT NULL;

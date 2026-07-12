import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, transactionsTable, bonusMissionsTable } from "@workspace/db";
import {
  awardXpForEventInTx,
  grantAchievementIfNewInTx,
  completeMissionIfPendingInTx,
  completeBonusIfAssignedInTx,
} from "../lib/xp";
import { computeFingerprint, isUniqueViolation } from "../lib/fingerprint";
import { transactionEvidenceRef } from "../lib/evidence";
import { evaluateBudgetGuardianInTx } from "../lib/budget-guardian";
import { failpoint } from "../lib/failpoints";
import {
  evaluateTransactionSemantics,
  type TransactionClassification,
  type ClassificationStatus,
} from "../lib/transaction-semantics";

import {
  ListTransactionsResponse,
  CreateTransactionBody,
  CreateTransactionResponse,
  GetTransactionParams,
  GetTransactionResponse,
  UpdateTransactionParams,
  UpdateTransactionBody,
  UpdateTransactionResponse,
  DeleteTransactionParams,
} from "@workspace/api-zod";

/**
 * Compatibility classification for the existing manual income/expense
 * workflows (docs/transaction-semantics.md, "Legacy Compatibility"): until a
 * classification UI exists, a user-created income/expense receives an
 * explicit confirmed classification so budgets, Budget Guardian, and
 * gamification keep working exactly as before.
 */
function classificationForManualType(type: string) {
  return {
    classification: type === "income" ? "income" : "expense",
    classificationStatus: "confirmed",
    classificationConfidence: "high",
    classificationSource: "user",
  } as const;
}

const router: IRouter = Router();

router.get("/transactions", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(transactionsTable)
    .orderBy(transactionsTable.createdAt);
  const mapped = rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    createdAt: r.createdAt.toISOString(),
  }));
  res.json(ListTransactionsResponse.parse(mapped));
});

router.post("/transactions", async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const dateStr =
    typeof parsed.data.date === "string"
      ? parsed.data.date
      : (parsed.data.date as Date).toISOString().slice(0, 10);
  const fingerprint = computeFingerprint({
    date: dateStr,
    description: parsed.data.description,
    amount: parsed.data.amount,
    type: parsed.data.type,
    accountId: parsed.data.accountId,
  });

  // ONE atomic action = ONE database transaction. The financial insert and
  // every gamification write (action XP, achievement, daily mission, streak,
  // weekly challenge, bonus mission, Budget Guardian) commit together or not
  // at all: any failure below rolls back the inserted transaction row too,
  // and the client gets a 500 — never a saved record with missing rewards.
  const outcome = await db.transaction(async (tx) => {
    // ON CONFLICT DO NOTHING against the partial unique index on fingerprint:
    // under concurrent identical requests exactly one insert wins; the rest
    // return no row and are reported as explicit duplicates (409) — never a
    // silent success, and never any XP or mission progress.
    const [row] = await tx
      .insert(transactionsTable)
      .values({
        ...parsed.data,
        date: dateStr,
        amount: String(parsed.data.amount),
        fingerprint,
        ...classificationForManualType(parsed.data.type),
      })
      .onConflictDoNothing()
      .returning();

    if (!row) {
      const [existing] = await tx
        .select()
        .from(transactionsTable)
        .where(eq(transactionsTable.fingerprint, fingerprint));
      return { kind: "duplicate" as const, existingId: existing?.id };
    }

    failpoint("transaction.afterInsert");

    // Evidence gate (docs/transaction-semantics.md): only transactions the
    // centralized evaluator deems unambiguous may support XP, achievements,
    // missions, or bonus evidence. Manual income/expense creates are always
    // confirmed (above), so behavior is unchanged for them — but if a row
    // ever lands here unclassified or ambiguous, it earns nothing.
    const effects = evaluateTransactionSemantics({
      id: row.id,
      amount: Number(row.amount),
      classification: row.classification as TransactionClassification,
      classificationStatus: row.classificationStatus as ClassificationStatus,
    });

    if (effects.eligibleForGamification) {
      // Award XP keyed on the fingerprint (not the row id): xp_events has a
      // unique (userId, eventType, sourceId) constraint, so re-logging an
      // identical transaction — even concurrently — awards XP exactly once.
      const award = await awardXpForEventInTx(
        tx,
        "transaction_created",
        fingerprint,
        10,
      );

      if (award.xpAwarded > 0) {
        // Genuinely new transaction: grant first-transaction achievement if
        // new; complete today's mission if it matches (incl. streak + weekly
        // challenge); complete the day's bonus mission if log_transaction is
        // today's assigned bonus. All in this same transaction.
        await grantAchievementIfNewInTx(
          tx,
          "first_transaction",
          "First Transaction",
          "Logged your very first transaction",
        );
        await completeMissionIfPendingInTx(tx, "log_transaction");
        failpoint("transaction.afterMission");
        await completeBonusIfAssignedInTx(
          tx,
          "log_transaction",
          transactionEvidenceRef(row.id),
        );
      }
    }

    // A new transaction may complete the picture for last month's budgets;
    // evaluate the one-time Budget Guardian badge (idempotent, completed
    // months only).
    await evaluateBudgetGuardianInTx(tx);

    return { kind: "created" as const, row };
  });

  if (outcome.kind === "duplicate") {
    res.status(409).json({
      error:
        "Duplicate transaction: an identical transaction (same date, description, amount, type, and account) already exists.",
      duplicate: true,
      ...(outcome.existingId !== undefined
        ? { existingId: outcome.existingId }
        : {}),
    });
    return;
  }

  const row = outcome.row;
  res
    .status(201)
    .json(
      CreateTransactionResponse.parse({
        ...row,
        amount: Number(row.amount),
        createdAt: row.createdAt.toISOString(),
      }),
    );
});

router.get("/transactions/:id", async (req, res): Promise<void> => {
  const params = GetTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.json(
    GetTransactionResponse.parse({
      ...row,
      amount: Number(row.amount),
      createdAt: row.createdAt.toISOString(),
    }),
  );
});

router.patch("/transactions/:id", async (req, res): Promise<void> => {
  const params = UpdateTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.amount !== undefined)
    updateData.amount = String(parsed.data.amount);
  // Zod coerces `date` to a Date object; normalize to the canonical
  // YYYY-MM-DD string (same as the create path) so the stored value and the
  // fingerprint input are identical to what a create would produce.
  if (parsed.data.date !== undefined) {
    updateData.date =
      typeof parsed.data.date === "string"
        ? parsed.data.date
        : (parsed.data.date as Date).toISOString().slice(0, 10);
  }
  // Manual type edits re-classify through the same compatibility mapping as
  // creates: the classification facts must never contradict the stored type.
  if (parsed.data.type !== undefined) {
    Object.assign(updateData, classificationForManualType(parsed.data.type));
  }
  // Keep the dedup fingerprint in sync with the fields it derives from.
  updateData.fingerprint = computeFingerprint({
    date: (updateData.date as string | undefined) ?? existing.date,
    description: parsed.data.description ?? existing.description,
    amount: parsed.data.amount ?? existing.amount,
    type: parsed.data.type ?? existing.type,
    accountId:
      parsed.data.accountId !== undefined
        ? parsed.data.accountId
        : existing.accountId,
  });
  let row;
  try {
    [row] = await db
      .update(transactionsTable)
      .set(updateData)
      .where(eq(transactionsTable.id, params.data.id))
      .returning();
  } catch (err) {
    // The recalculated fingerprint collided with another row's — the edit
    // would make this transaction an exact duplicate. Explicit 409, keyed on
    // the same partial unique index that guards creates.
    if (isUniqueViolation(err)) {
      const [existing] = await db
        .select()
        .from(transactionsTable)
        .where(
          eq(transactionsTable.fingerprint, updateData.fingerprint as string),
        );
      res.status(409).json({
        error:
          "Duplicate transaction: this update would make the transaction identical to an existing one.",
        duplicate: true,
        ...(existing ? { existingId: existing.id } : {}),
      });
      return;
    }
    throw err;
  }
  if (!row) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.json(
    UpdateTransactionResponse.parse({
      ...row,
      amount: Number(row.amount),
      createdAt: row.createdAt.toISOString(),
    }),
  );
});

router.delete("/transactions/:id", async (req, res): Promise<void> => {
  const params = DeleteTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Runtime evidence-integrity protection: deleting a transaction must not
  // leave any bonus mission pointing at a row that no longer exists. The
  // evidence is genuinely gone, so the reference is cleared (never remapped
  // to an unrelated transaction) atomically with the delete.
  const row = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(transactionsTable)
      .where(eq(transactionsTable.id, params.data.id))
      .returning();
    if (!deleted) return undefined;
    await tx
      .update(bonusMissionsTable)
      .set({ evidenceRef: null })
      .where(
        eq(bonusMissionsTable.evidenceRef, transactionEvidenceRef(deleted.id)),
      );
    return deleted;
  });
  if (!row) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

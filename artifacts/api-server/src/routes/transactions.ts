import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, transactionsTable, bonusMissionsTable } from "@workspace/db";
import {
  awardXpForEvent,
  grantAchievementIfNew,
  completeMissionIfPending,
  completeBonusIfAssigned,
} from "../lib/xp";
import { computeFingerprint, isUniqueViolation } from "../lib/fingerprint";
import { transactionEvidenceRef } from "../lib/evidence";
import { evaluateBudgetGuardian } from "../lib/budget-guardian";
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

const router: IRouter = Router();

router.get("/transactions", async (req, res): Promise<void> => {
  const rows = await db.select().from(transactionsTable).orderBy(transactionsTable.createdAt);
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
  const dateStr = typeof parsed.data.date === "string"
    ? parsed.data.date
    : (parsed.data.date as Date).toISOString().slice(0, 10);
  const fingerprint = computeFingerprint({
    date: dateStr,
    description: parsed.data.description,
    amount: parsed.data.amount,
    type: parsed.data.type,
    accountId: parsed.data.accountId,
  });

  // ON CONFLICT DO NOTHING against the partial unique index on fingerprint:
  // under concurrent identical requests exactly one insert wins; the rest
  // return no row and are reported as explicit duplicates (409) — never a
  // silent success.
  const [row] = await db
    .insert(transactionsTable)
    .values({ ...parsed.data, date: dateStr, amount: String(parsed.data.amount), fingerprint })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    const [existing] = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.fingerprint, fingerprint));
    res.status(409).json({
      error:
        "Duplicate transaction: an identical transaction (same date, description, amount, type, and account) already exists.",
      duplicate: true,
      ...(existing ? { existingId: existing.id } : {}),
    });
    return;
  }

  // Award XP keyed on the fingerprint (not the row id): xp_events has a
  // unique (userId, eventType, sourceId) constraint, so re-logging an
  // identical transaction — even concurrently — awards XP exactly once.
  const award = await awardXpForEvent("transaction_created", fingerprint, 10);

  if (award.xpAwarded > 0) {
    // Genuinely new transaction: grant first-transaction achievement if new;
    // complete today's mission if it matches; complete the day's bonus
    // mission if log_transaction is today's assigned bonus. Action XP,
    // mission XP, and bonus XP are all separate idempotent xp_events.
    await grantAchievementIfNew(
      "first_transaction",
      "First Transaction",
      "Logged your very first transaction"
    );
    await completeMissionIfPending("log_transaction");
    await completeBonusIfAssigned("log_transaction", transactionEvidenceRef(row.id));
  }

  // A new transaction may complete the picture for last month's budgets;
  // evaluate the one-time Budget Guardian badge (idempotent, completed
  // months only).
  await evaluateBudgetGuardian();

  res.status(201).json(CreateTransactionResponse.parse({ ...row, amount: Number(row.amount), createdAt: row.createdAt.toISOString() }));
});

router.get("/transactions/:id", async (req, res): Promise<void> => {
  const params = GetTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.json(GetTransactionResponse.parse({ ...row, amount: Number(row.amount), createdAt: row.createdAt.toISOString() }));
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
  if (parsed.data.amount !== undefined) updateData.amount = String(parsed.data.amount);
  // Zod coerces `date` to a Date object; normalize to the canonical
  // YYYY-MM-DD string (same as the create path) so the stored value and the
  // fingerprint input are identical to what a create would produce.
  if (parsed.data.date !== undefined) {
    updateData.date =
      typeof parsed.data.date === "string"
        ? parsed.data.date
        : (parsed.data.date as Date).toISOString().slice(0, 10);
  }
  // Keep the dedup fingerprint in sync with the fields it derives from.
  updateData.fingerprint = computeFingerprint({
    date: (updateData.date as string | undefined) ?? existing.date,
    description: parsed.data.description ?? existing.description,
    amount: parsed.data.amount ?? existing.amount,
    type: parsed.data.type ?? existing.type,
    accountId: parsed.data.accountId !== undefined ? parsed.data.accountId : existing.accountId,
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
        .where(eq(transactionsTable.fingerprint, updateData.fingerprint as string));
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
  res.json(UpdateTransactionResponse.parse({ ...row, amount: Number(row.amount), createdAt: row.createdAt.toISOString() }));
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
      .where(eq(bonusMissionsTable.evidenceRef, transactionEvidenceRef(deleted.id)));
    return deleted;
  });
  if (!row) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

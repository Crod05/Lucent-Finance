import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";
import { awardXpForEvent, grantAchievementIfNew, completeMissionIfPending } from "../lib/xp";
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

/**
 * Deterministic dedup fingerprint over (date, normalized description, amount,
 * type, accountId). Must stay in sync with the SQL backfill expression used
 * when the column was added.
 */
function computeFingerprint(input: {
  date: string;
  description: string;
  amount: number | string;
  type: string;
  accountId: number | null | undefined;
}): string {
  const desc = input.description.trim().toLowerCase().replace(/\s+/g, " ");
  const amt = Number(input.amount).toFixed(2);
  const account = input.accountId == null ? "" : String(input.accountId);
  return createHash("sha256")
    .update(`${input.date}|${desc}|${amt}|${input.type}|${account}`)
    .digest("hex");
}

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

  const [row] = await db
    .insert(transactionsTable)
    .values({ ...parsed.data, date: dateStr, amount: String(parsed.data.amount), fingerprint })
    .returning();

  // Award XP keyed on the fingerprint (not the row id): xp_events has a
  // unique (userId, eventType, sourceId) constraint, so re-logging an
  // identical transaction — even concurrently — awards XP exactly once.
  const award = await awardXpForEvent("transaction_created", fingerprint, 10);

  if (award.xpAwarded > 0) {
    // Genuinely new transaction: grant first-transaction achievement if new;
    // complete today's mission if it matches.
    await grantAchievementIfNew(
      "first_transaction",
      "First Transaction",
      "Logged your very first transaction"
    );
    await completeMissionIfPending("log_transaction");
  }

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
  // Keep the dedup fingerprint in sync with the fields it derives from.
  updateData.fingerprint = computeFingerprint({
    date: (updateData.date as string | undefined) ?? existing.date,
    description: parsed.data.description ?? existing.description,
    amount: parsed.data.amount ?? existing.amount,
    type: parsed.data.type ?? existing.type,
    accountId: parsed.data.accountId !== undefined ? parsed.data.accountId : existing.accountId,
  });
  const [row] = await db
    .update(transactionsTable)
    .set(updateData)
    .where(eq(transactionsTable.id, params.data.id))
    .returning();
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
  const [row] = await db.delete(transactionsTable).where(eq(transactionsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

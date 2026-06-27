import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, accountsTable } from "@workspace/db";
import {
  ListAccountsResponse,
  CreateAccountBody,
  CreateAccountResponse,
  UpdateAccountParams,
  UpdateAccountBody,
  UpdateAccountResponse,
  DeleteAccountParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapAccount(r: typeof accountsTable.$inferSelect) {
  return {
    ...r,
    balance: Number(r.balance),
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/accounts", async (req, res): Promise<void> => {
  const rows = await db.select().from(accountsTable).orderBy(accountsTable.createdAt);
  res.json(ListAccountsResponse.parse(rows.map(mapAccount)));
});

router.post("/accounts", async (req, res): Promise<void> => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(accountsTable)
    .values({ ...parsed.data, balance: String(parsed.data.balance) })
    .returning();
  res.status(201).json(CreateAccountResponse.parse(mapAccount(row)));
});

router.patch("/accounts/:id", async (req, res): Promise<void> => {
  const params = UpdateAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.balance !== undefined) updateData.balance = String(parsed.data.balance);
  const [row] = await db
    .update(accountsTable)
    .set(updateData)
    .where(eq(accountsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(UpdateAccountResponse.parse(mapAccount(row)));
});

router.delete("/accounts/:id", async (req, res): Promise<void> => {
  const params = DeleteAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(accountsTable).where(eq(accountsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

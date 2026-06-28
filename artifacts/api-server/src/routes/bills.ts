import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, billsTable } from "@workspace/db";
import { awardXp, grantAchievementIfNew } from "../lib/xp";
import {
  ListBillsResponse,
  CreateBillBody,
  CreateBillResponse,
  UpdateBillParams,
  UpdateBillBody,
  UpdateBillResponse,
  DeleteBillParams,
  MarkBillPaidParams,
  MarkBillPaidResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapBill(r: typeof billsTable.$inferSelect) {
  return {
    ...r,
    amount: Number(r.amount),
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/bills", async (req, res): Promise<void> => {
  const rows = await db.select().from(billsTable).orderBy(billsTable.dueDate);
  res.json(ListBillsResponse.parse(rows.map(mapBill)));
});

router.post("/bills", async (req, res): Promise<void> => {
  const parsed = CreateBillBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const dueDateStr = typeof parsed.data.dueDate === "string"
    ? parsed.data.dueDate
    : (parsed.data.dueDate as Date).toISOString().slice(0, 10);
  const [row] = await db
    .insert(billsTable)
    .values({ ...parsed.data, dueDate: dueDateStr, amount: String(parsed.data.amount) })
    .returning();
  res.status(201).json(CreateBillResponse.parse(mapBill(row)));
});

router.patch("/bills/:id", async (req, res): Promise<void> => {
  const params = UpdateBillParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBillBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.amount !== undefined) updateData.amount = String(parsed.data.amount);
  const [row] = await db
    .update(billsTable)
    .set(updateData)
    .where(eq(billsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }
  res.json(UpdateBillResponse.parse(mapBill(row)));
});

router.delete("/bills/:id", async (req, res): Promise<void> => {
  const params = DeleteBillParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(billsTable).where(eq(billsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }
  res.sendStatus(204);
});

router.patch("/bills/:id/pay", async (req, res): Promise<void> => {
  const params = MarkBillPaidParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .update(billsTable)
    .set({ status: "paid" })
    .where(eq(billsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }

  // Award XP for paying a bill; grant bill-slayer achievement if new
  await awardXp(15);
  await grantAchievementIfNew("bill_slayer", "Bill Slayer", "Marked your first bill as paid");

  res.json(MarkBillPaidResponse.parse(mapBill(row)));
});

export default router;

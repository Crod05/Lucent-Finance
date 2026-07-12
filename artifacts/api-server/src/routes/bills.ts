import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db, billsTable } from "@workspace/db";
import {
  awardXpForEventInTx,
  grantAchievementIfNewInTx,
  completeMissionIfPendingInTx,
  completeBonusIfAssignedInTx,
} from "../lib/xp";
import { failpoint } from "../lib/failpoints";
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
  const dueDateStr =
    typeof parsed.data.dueDate === "string"
      ? parsed.data.dueDate
      : (parsed.data.dueDate as Date).toISOString().slice(0, 10);
  const [row] = await db
    .insert(billsTable)
    .values({
      ...parsed.data,
      dueDate: dueDateStr,
      amount: String(parsed.data.amount),
    })
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
  if (parsed.data.amount !== undefined)
    updateData.amount = String(parsed.data.amount);
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
  const [row] = await db
    .delete(billsTable)
    .where(eq(billsTable.id, params.data.id))
    .returning();
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
  // ONE atomic action = ONE database transaction. The paid-status flip and
  // every gamification write commit together or not at all: if any award
  // step fails, the transaction rolls back and the bill remains unpaid.
  const outcome = await db.transaction(async (tx) => {
    // Atomic conditional transition: only unpaid bills flip to paid. Under
    // concurrent pay requests exactly one UPDATE matches; the losers see no
    // row and take the already-paid path with no XP, streak, or bonus.
    const [row] = await tx
      .update(billsTable)
      .set({ status: "paid" })
      .where(
        and(eq(billsTable.id, params.data.id), ne(billsTable.status, "paid")),
      )
      .returning();

    if (!row) {
      const [existing] = await tx
        .select()
        .from(billsTable)
        .where(eq(billsTable.id, params.data.id));
      if (!existing) return { kind: "notFound" as const };
      // Already paid: return the bill as-is without awarding anything.
      return { kind: "alreadyPaid" as const, bill: existing };
    }

    failpoint("bill.afterPaid");

    // Bill XP (idempotent per bill id); Bill Slayer if new; today's mission
    // if it matches (incl. streak + weekly challenge); the day's bonus
    // mission if pay_bill is today's assigned bonus. All idempotent, all in
    // this same transaction.
    await awardXpForEventInTx(tx, "bill_paid", String(row.id), 15);
    await grantAchievementIfNewInTx(
      tx,
      "bill_slayer",
      "Bill Slayer",
      "Marked your first bill as paid",
    );
    await completeMissionIfPendingInTx(tx, "pay_bill");
    failpoint("bill.afterMission");
    await completeBonusIfAssignedInTx(tx, "pay_bill", `bill:${row.id}`);

    return { kind: "paid" as const, bill: row };
  });

  if (outcome.kind === "notFound") {
    res.status(404).json({ error: "Bill not found" });
    return;
  }
  res.json(MarkBillPaidResponse.parse(mapBill(outcome.bill)));
});

export default router;

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, budgetsTable } from "@workspace/db";
import { completeMissionIfPending } from "../lib/xp";
import {
  ListBudgetsResponse,
  CreateBudgetBody,
  CreateBudgetResponse,
  UpdateBudgetParams,
  UpdateBudgetBody,
  UpdateBudgetResponse,
  DeleteBudgetParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapBudget(r: typeof budgetsTable.$inferSelect) {
  return {
    ...r,
    monthlyLimit: Number(r.monthlyLimit),
    currentSpent: Number(r.currentSpent),
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/budgets", async (req, res): Promise<void> => {
  const rows = await db.select().from(budgetsTable).orderBy(budgetsTable.createdAt);

  // Visiting the Budgets page (this list is only fetched there) is the
  // evidence for the review_budget mission.
  await completeMissionIfPending("review_budget");

  res.json(ListBudgetsResponse.parse(rows.map(mapBudget)));
});

router.post("/budgets", async (req, res): Promise<void> => {
  const parsed = CreateBudgetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(budgetsTable)
    .values({ ...parsed.data, monthlyLimit: String(parsed.data.monthlyLimit) })
    .returning();
  res.status(201).json(CreateBudgetResponse.parse(mapBudget(row)));
});

router.patch("/budgets/:id", async (req, res): Promise<void> => {
  const params = UpdateBudgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBudgetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.monthlyLimit !== undefined) updateData.monthlyLimit = String(parsed.data.monthlyLimit);
  const [row] = await db
    .update(budgetsTable)
    .set(updateData)
    .where(eq(budgetsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Budget not found" });
    return;
  }
  res.json(UpdateBudgetResponse.parse(mapBudget(row)));
});

router.delete("/budgets/:id", async (req, res): Promise<void> => {
  const params = DeleteBudgetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(budgetsTable).where(eq(budgetsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Budget not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

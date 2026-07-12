import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, budgetsTable } from "@workspace/db";
import { completeMissionIfPendingInTx } from "../lib/xp";
import { evaluateBudgetGuardianInTx } from "../lib/budget-guardian";
import {
  ListBudgetsResponse,
  MarkBudgetsReviewedResponse,
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
  const rows = await db
    .select()
    .from(budgetsTable)
    .orderBy(budgetsTable.createdAt);
  res.json(ListBudgetsResponse.parse(rows.map(mapBudget)));
});

// Deliberate intent endpoint: the client posts here when the player actually
// views the Budgets page. The server verifies the review_budget mission is
// today's assignment and still pending; completion + XP are atomic and
// idempotent inside completeMissionIfPending, so refreshes or repeated posts
// can never double-award.
router.post("/budgets/reviewed", async (req, res): Promise<void> => {
  // ONE atomic action = ONE database transaction: mission completion (incl.
  // XP, streak, weekly challenge) and the Budget Guardian evaluation for the
  // most recent completed month commit together. Both are idempotent, so
  // repeated posts can never double-award.
  const result = await db.transaction(async (tx) => {
    const completion = await completeMissionIfPendingInTx(tx, "review_budget");
    await evaluateBudgetGuardianInTx(tx);
    return completion;
  });
  res.json(MarkBudgetsReviewedResponse.parse(result));
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
  if (parsed.data.monthlyLimit !== undefined)
    updateData.monthlyLimit = String(parsed.data.monthlyLimit);
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
  const [row] = await db
    .delete(budgetsTable)
    .where(eq(budgetsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Budget not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

import { Router, type IRouter } from "express";
import { gte, and, lte } from "drizzle-orm";
import { db, transactionsTable, budgetsTable, billsTable, accountsTable } from "@workspace/db";
import { completeMissionIfPending } from "../lib/xp";
import {
  GetInsightsSummaryResponse,
  GetSpendingByCategoryResponse,
  GetMonthlyTrendsResponse,
  GetUpcomingBillsResponse,
  MarkInsightsViewedResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/insights/summary", async (req, res): Promise<void> => {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const transactions = await db.select().from(transactionsTable);
  const accounts = await db.select().from(accountsTable);
  const budgets = await db.select().from(budgetsTable);

  const thirtyDaysOut = new Date(now);
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
  const today = now.toISOString().slice(0, 10);
  const in30Days = thirtyDaysOut.toISOString().slice(0, 10);

  const upcomingBills = await db
    .select()
    .from(billsTable)
    .where(and(gte(billsTable.dueDate, today), lte(billsTable.dueDate, in30Days)));

  const sevenDaysOut = new Date(now);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const in7Days = sevenDaysOut.toISOString().slice(0, 10);
  const billsDueThisWeek = upcomingBills.filter((b) => b.dueDate <= in7Days && b.status !== "paid").length;

  // This month transactions
  const monthlyTransactions = transactions.filter(
    (t) => t.date >= firstOfMonth && t.date <= lastOfMonth
  );
  const totalIncome = monthlyTransactions.filter((t) => t.type === "income").reduce((sum, t) => sum + Number(t.amount), 0);
  const totalExpenses = monthlyTransactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + Number(t.amount), 0);

  const totalBalance = accounts.reduce((sum, a) => {
    const bal = Number(a.balance);
    return a.type === "credit" ? sum - bal : sum + bal;
  }, 0);

  // Budget usage this month
  const monthBudgets = budgets.filter((b) => b.month === now.getMonth() + 1 && b.year === now.getFullYear());
  const totalLimit = monthBudgets.reduce((sum, b) => sum + Number(b.monthlyLimit), 0);
  const totalSpent = monthBudgets.reduce((sum, b) => sum + Number(b.currentSpent), 0);
  const budgetUsagePercent = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;

  const upcomingBillsTotal = upcomingBills
    .filter((b) => b.status !== "paid")
    .reduce((sum, b) => sum + Number(b.amount), 0);

  res.json(
    GetInsightsSummaryResponse.parse({
      totalIncome,
      totalExpenses,
      netSavings: totalIncome - totalExpenses,
      totalBalance,
      budgetUsagePercent,
      upcomingBillsTotal,
      billsDueThisWeek,
    })
  );
});

router.get("/insights/spending", async (req, res): Promise<void> => {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const transactions = await db
    .select()
    .from(transactionsTable)
    .where(and(gte(transactionsTable.date, firstOfMonth), lte(transactionsTable.date, lastOfMonth)));

  const expenses = transactions.filter((t) => t.type === "expense");
  const totalExpenses = expenses.reduce((sum, t) => sum + Number(t.amount), 0);

  const byCategory: Record<string, number> = {};
  for (const t of expenses) {
    byCategory[t.category] = (byCategory[t.category] || 0) + Number(t.amount);
  }

  const result = Object.entries(byCategory).map(([category, amount]) => ({
    category,
    amount,
    percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
  }));

  res.json(GetSpendingByCategoryResponse.parse(result));
});

router.get("/insights/trends", async (req, res): Promise<void> => {
  const transactions = await db.select().from(transactionsTable);

  // Group by month/year
  const grouped: Record<string, { income: number; expenses: number; month: number; year: number }> = {};
  for (const t of transactions) {
    const [yearStr, monthStr] = t.date.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const key = `${year}-${month}`;
    if (!grouped[key]) grouped[key] = { income: 0, expenses: 0, month, year };
    if (t.type === "income") grouped[key].income += Number(t.amount);
    else grouped[key].expenses += Number(t.amount);
  }

  const result = Object.values(grouped).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  );

  res.json(GetMonthlyTrendsResponse.parse(result));
});

// Deliberate intent endpoint: the client posts here when the player actually
// views the Insights page. The server verifies the check_insights mission is
// today's assignment and still pending; completion + XP are atomic and
// idempotent inside completeMissionIfPending, so refreshes or repeated posts
// can never double-award.
router.post("/insights/viewed", async (req, res): Promise<void> => {
  const result = await completeMissionIfPending("check_insights");
  res.json(MarkInsightsViewedResponse.parse(result));
});

router.get("/insights/upcoming-bills", async (req, res): Promise<void> => {
  const now = new Date();
  const in30Days = new Date(now);
  in30Days.setDate(in30Days.getDate() + 30);
  const today = now.toISOString().slice(0, 10);
  const future = in30Days.toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(billsTable)
    .where(and(gte(billsTable.dueDate, today), lte(billsTable.dueDate, future)));

  res.json(GetUpcomingBillsResponse.parse(rows.map((r) => ({ ...r, amount: Number(r.amount), createdAt: r.createdAt.toISOString() }))));
});

export default router;

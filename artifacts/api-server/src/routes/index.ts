import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transactionsRouter from "./transactions";
import budgetsRouter from "./budgets";
import billsRouter from "./bills";
import accountsRouter from "./accounts";
import insightsRouter from "./insights";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transactionsRouter);
router.use(budgetsRouter);
router.use(billsRouter);
router.use(accountsRouter);
router.use(insightsRouter);

export default router;

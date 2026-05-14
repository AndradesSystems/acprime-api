import { Router } from "express";
import { FinanceController } from "../controllers/finance.controller";
import { withAuth } from "../middlewares/auth.wrapper";

export const financeRoutes = Router();

/* ==========================================================================
   FINANCE / PERSONAL EXPENSES
   ========================================================================== */

// 1. Relatórios e Listagens Gerais
financeRoutes.get(
  "/expenses/summary",
  withAuth(FinanceController.expensesSummary)
);
financeRoutes.get("/expenses", withAuth(FinanceController.listExpenses));

// 2. Operações de Criação
financeRoutes.post("/expenses", withAuth(FinanceController.createExpense));

// 3. Operações por ID e Status
financeRoutes.get("/expenses/:id", withAuth(FinanceController.getExpenseById));
financeRoutes.put("/expenses/:id", withAuth(FinanceController.updateExpense));
financeRoutes.delete(
  "/expenses/:id",
  withAuth(FinanceController.removeExpense)
);

/**
 * Rota de Baixa Rápida
 * Atualiza apenas o status (PENDENTE, CONCLUIDO, CANCELADO)
 */
financeRoutes.patch(
  "/expenses/:id/status",
  withAuth(FinanceController.updateStatus)
);

/* ==========================================================================
   FINANCE / CONTRACTS NOTIFICATIONS
   ========================================================================== */

/**
 * Disparo Manual de Notificação (Andrade - WhatsApp)
 * POST /finance/contracts/:id/notify
 */
financeRoutes.post(
  "/contracts/:id/notify",
  withAuth(FinanceController.notifyContract)
);
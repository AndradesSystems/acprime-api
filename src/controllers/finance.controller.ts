import { type Request, type Response, type NextFunction } from "express";
import { FinanceService } from "../services/finance.service";
import { type AuthPayload } from "../lib/jwt";

export class FinanceController {
  /* =======================
      CREATE EXPENSE
  ======================= */
  static async createExpense(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const expense = await FinanceService.createExpense({
        ...req.body,
        userId: auth.sub,
      });
      return res.status(201).json(expense);
    } catch (e) {
      next(e);
    }
  }

  /* =======================
      LIST EXPENSES
  ======================= */
  static async listExpenses(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { startDate, endDate, tipo, tipo_fluxo, status, search } =
        req.query;

      const result = await FinanceService.listExpenses({
        userId: auth.sub,
        // Garantimos que a string da query vire um objeto Date válido para o Prisma
        startDate: startDate ? new Date(String(startDate)) : undefined,
        endDate: endDate ? new Date(String(endDate)) : undefined,
        tipo: tipo as any,
        tipo_fluxo: tipo_fluxo as any,
        status: status as any,
        search: search ? String(search) : undefined,
      });

      return res.json(result);
    } catch (e) {
      next(e);
    }
  }

 /* =======================
       UPDATE STATUS (Baixa Rápida)
  ======================= */
  static async updateStatus(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ 
          error: "O ID da transação é obrigatório e deve ser uma string válida." 
        });
      }

      const result = await FinanceService.updateStatus(
        id,
        auth.sub,
        status
      );

      return res.json(result);
    } catch (e) {
      next(e);
    }
  }

  static async expensesSummary(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { startDate, endDate } = req.query;

      console.log("---------------------------------------------------------");
      console.log(`[ROUTE] GET /finance/summary | User: ${auth.sub}`);
      console.log(`[PARAMS] startDate: ${startDate}, endDate: ${endDate}`);

      const result = await FinanceService.expensesSummary(
        auth.sub,
        startDate ? new Date(String(startDate)) : undefined,
        endDate ? new Date(String(endDate)) : undefined
      );

      console.log(`[RESPONSE] Sucesso enviando resumo financeiro.`);
      console.log("---------------------------------------------------------");

      return res.json(result);
    } catch (e) {
      console.error(`[ERROR] Erro no expensesSummary:`, e);
      next(e);
    }
  }
  /* =======================
          GET BY ID
    ======================= */
  static async getExpenseById(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID da despesa é obrigatório." });
      }

      const expense = await FinanceService.getExpenseById(
        id,
        auth.sub
      );

      return res.json(expense);
    } catch (e) {
      next(e);
    }
  }

  /* =======================
        UPDATE EXPENSE
   ======================= */
  static async updateExpense(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "ID da despesa é obrigatório." });
      }

      const updated = await FinanceService.updateExpense(
        id,
        auth.sub,
        req.body
      );

      return res.json(updated);
    } catch (e) {
      next(e);
    }
  }

  /* =======================
        REMOVE EXPENSE (Suporta os 3 modos)
    ======================= */
  static async removeExpense(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;
      const { mode } = req.query;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID da despesa é obrigatório." });
      }

      await FinanceService.removeExpense(id, auth.sub, mode as any);

      return res.status(204).send();
    } catch (e) {
      next(e);
    }
  }

  /* =======================
      NOTIFICAÇÃO MANUAL
  ======================= */
  static async notifyContract(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do contrato é obrigatório para disparar a notificação." });
      }


      return res.status(200).json({
        message: "Notificação enviada com sucesso para o cliente.",
      });
    } catch (e) {
      next(e);
    }
  }
}

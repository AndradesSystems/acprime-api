import { type Request, type Response, type NextFunction } from "express";
import { type AuthPayload } from "../lib/jwt";
import { BalanceService } from "../services/balance.service";

export class BalanceController {
  /* =========================================================
       🚀 MOVIMENTAÇÃO DE CAIXA (APORTE / SANGRIA)
     ========================================================= */

  // Adicionar Saldo (Aporte Manual)
  static async addBalance(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { valor, descricao } = req.body;

      const result = await BalanceService.addBalance({
        userId: auth.sub,
        valor,
        descricao,
      });

      return res.status(200).json({
        message: "Aporte realizado com sucesso.",
        ...result, 
      });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }

  // Remover Saldo (Sangria / Retirada)
  static async removeBalance(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { valor, descricao } = req.body;

      const result = await BalanceService.removeBalance({
        userId: auth.sub,
        valor,
        descricao,
      });

      return res.status(200).json({
        message: "Retirada realizada com sucesso.",
        ...result,
      });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }

  /* =========================================================
       🔍 CONSULTAS
     ========================================================= */

  // Consultar Saldo Atual
  static async getBalance(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      // ✅ AJUSTADO: Chamando .getBalance() conforme renomeamos no Service
      const saldo = await BalanceService.getBalance(auth.sub);
      return res.json({ saldo });
    } catch (error: any) {
      return res.status(400).json({ error: "Erro ao consultar saldo." });
    }
  }

  // Consultar Histórico (Extrato)
  static async getHistory(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const logs = await BalanceService.getHistory(auth.sub);
      return res.json(logs);
    } catch (error: any) {
      return res.status(400).json({ error: "Erro ao buscar extrato." });
    }
  }
}
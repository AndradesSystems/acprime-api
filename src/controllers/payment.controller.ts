import { type Request, type Response, type NextFunction } from "express";
import { PaymentService } from "../services/payment.service";
import { type AuthPayload } from "../lib/jwt";
import { AppError } from "../middlewares/error.middleware";

export class PaymentController {

  /* ===============================
        ✅ QUITAÇÃO TOTAL (Payoff)
  =============================== */
  static async payFullContract(req: Request, res: Response, next: NextFunction, auth: AuthPayload) {
    try {
      const { contractId } = req.params;

      // Validação explícita
      if (!contractId || typeof contractId !== 'string') {
        return res.status(400).json({ error: "ID do contrato é obrigatório e deve ser uma string." });
      }

      const result = await PaymentService.payFullContract(
        contractId, // Aqui o TS já sabe que é string
        auth.sub
      );

      return res.status(200).json(result);
    } catch (e) {
      return next(e);
    }
  }

 /* ===============================
        🗑️ EXCLUIR PAGAMENTO (Estorno)
     =============================== */

  static async delete(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      // Alterado de { id } para { paymentId } para bater com a Rota
      const { paymentId } = req.params;

      if (!paymentId || typeof paymentId !== 'string') {
        return res.status(400).json({
          error: "O ID do pagamento é obrigatório e deve ser válido."
        });
      }

      // Passamos o paymentId para o service
      await PaymentService.delete(paymentId, auth.sub);

      return res.status(204).send();
    } catch (e) {
      return next(e);
    }
  }

  /* ===============================
        ✅ PAGAR PARCELA INDIVIDUAL
  =============================== */
  static async payInstallment(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { installmentId } = req.params;

      if (!installmentId || typeof installmentId !== 'string') {
        return res.status(400).json({
          error: "O ID da parcela é obrigatório e deve ser uma string válida."
        });
      }

      const result = await PaymentService.payInstallment(
        installmentId,
        auth.sub
      );

      return res.status(200).json(result);
    } catch (e) {
      return next(e);
    }
  }

  /* ===============================
          CRIAÇÃO DE PAGAMENTO AVULSO
   =============================== */
  static async create(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { contractId } = req.params;

      if (!contractId || typeof contractId !== 'string') {
        return res.status(400).json({ error: "ID do contrato é obrigatório." });
      }

      const result = await PaymentService.create(
        contractId,
        req.body,
        auth.sub
      );

      return res.status(201).json(result);
    } catch (e) {
      return next(e);
    }
  }

  /* ===============================
         LISTAGENS E HISTÓRICO
   =============================== */
  static async listByContract(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { contractId } = req.params;

      if (typeof contractId !== 'string') {
        return res.status(400).json({ error: "ID do contrato inválido ou ausente." });
      }

      const result = await PaymentService.listByContract(contractId, auth.sub);

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  }

  /* ===============================
        LISTAGENS E HISTÓRICO
  =============================== */
  static async historyByContract(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { contractId } = req.params;

      if (!contractId || typeof contractId !== 'string') {
        return res.status(400).json({
          error: "ID do contrato é obrigatório e deve ser uma string válida."
        });
      }

      const result = await PaymentService.historyByContract(
        contractId,
        auth.sub
      );

      return res.status(200).json(result);
    } catch (e) {
      return next(e);
    }
  }

  /* ===============================
        📊 SUMMARY FINANCEIRO
  =============================== */
  static async financeSummary(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload // Adicionado para segurança
  ) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        throw new AppError("O período (startDate e endDate) é obrigatório.", 400);
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new AppError("Formato de data inválido.", 400);
      }

      // O Service agora filtra os pagamentos apenas do usuário logado
      const result = await PaymentService.financeSummary(start, end, auth.sub);

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  }

  /* ===============================
        📅 PAGAMENTOS DO PERÍODO
  =============================== */
  static async paymentsByPeriod(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload // Adicionado para segurança
  ) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        throw new AppError("Período (startDate e endDate) é obrigatório", 400);
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new AppError("Formato de data inválido.", 400);
      }

      // O Service agora retorna apenas os pagamentos que pertencem ao auth.sub
      const result = await PaymentService.paymentsByPeriod(start, end, auth.sub);

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  }
}
import { type Request, type Response, type NextFunction } from "express";
import { ContractService } from "../services/contract.service";
import { type AuthPayload } from "../lib/jwt";

export class ContractController {
  static async create(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const contract = await ContractService.create({
        ...req.body,
        userId: auth.sub, // Injetando o ID do usuário logado
      });
      return res.status(201).json(contract);
    } catch (e) {
      return next(e);
    }
  }

  static async list(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { startDate, endDate } = req.query;

      const filters: { userId: string; startDate?: Date; endDate?: Date } = {
        userId: auth.sub,
      };

      if (startDate) {
        filters.startDate = new Date(String(startDate));
      }

      if (endDate) {
        filters.endDate = new Date(String(endDate));
      }

      const result = await ContractService.list(filters);

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  }

  /** ✅ Lista contratos por CLIENTE com trava de segurança no Service */
  static async listByClientId(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { clientId } = req.params;

      if (!clientId || typeof clientId !== 'string') {
        return res.status(400).json({
          error: "O ID do cliente é obrigatório."
        });
      }

      const result = await ContractService.getById(clientId, auth.sub);

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  }

  /** ✅ Busca por ID: A validação de posse (userId) ocorre dentro do Service */
  static async getById(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do contrato é obrigatório." });
      }

      const contract = await ContractService.getById(id, auth.sub);

      return res.json(contract);
    } catch (e) {
      return next(e);
    }
  }

  /** ✅ DELETAR: Validação feita internamente no Service */
  static async remove(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do contrato é obrigatório." });
      }

      await ContractService.delete(id, auth.sub);

      return res.status(204).send();
    } catch (e) {
      return next(e);
    }
  }

  /** ✅ Atualiza vencimento: Removida a busca duplicada que existia no Controller */
  static async updateDueDate(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;
      const { vencimentoEm } = req.body;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do contrato é obrigatório." });
      }

      if (!vencimentoEm) {
        return res.status(400).json({ error: "Campo vencimentoEm é obrigatório" });
      }

      const updatedContract = await ContractService.updateDueDate(
        id,
        new Date(vencimentoEm),
        auth.sub
      );

      return res.json(updatedContract);
    } catch (e) {
      return next(e);
    }
  }

  /** ✅ Summary: Agora chama o service passando o auth.sub para segurança total */
  static async summary(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do contrato é obrigatório." });
      }

      const result = await ContractService.summary(id, auth.sub, new Date());

      return res.json(result);
    } catch (e) {
      return next(e);
    }
  }
}
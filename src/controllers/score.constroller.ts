import { type Request, type Response, type NextFunction } from "express";
import { ScoreService } from "../services/score.service";
import { type AuthPayload } from "../lib/jwt";

export class ScoreController {
  /**
   * 🟢 LISTAGEM COM SCORE (FILTRADO POR USER)
   */
  static async listAllWithScores(
    _req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const clientsWithScores = await ScoreService.buscarClientesComScores(auth.sub);
      return res.json(clientsWithScores);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * 🔄 RECÁLCULO MANUAL (APENAS DO USUÁRIO LOGADO)
   */
  static async forceRecalculate(
    _req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload // Pegamos o payload de autenticação aqui também
  ) {
    try {
      // 🔥 Passando o ID do usuário logado para rodar apenas nos clientes dele
      await ScoreService.calcularEAtualizarScoresPorUsuario(auth.sub);

      return res.status(200).json({
        success: true,
        message: "Seus scores foram reavaliados e atualizados com sucesso.",
      });
    } catch (e) {
      return next(e);
    }
  }
}
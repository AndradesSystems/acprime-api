import { type Request, type Response, type NextFunction } from "express";
import { ScoreService } from "../services/score.service";
import { type AuthPayload } from "../lib/jwt";
import { prisma } from "../lib/prisma";

export class ScoreController {
  /**
   * 🟢 LISTAGEM COM SCORE (FILTRADO POR USER)
   * Usa uma estratégia de Cooldown para evitar re-processar o motor em acessos repetidos
   */
  static async listAllWithScores(
    _req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const userId = auth.sub;
      const COOLDOWN_MINUTES = 10;

      // ⏱️ Verifica quando foi a última varredura global de score deste usuário
      const ultimoScoreCalculado = await prisma.clientScore.findFirst({
        where: { client: { userId } },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true }
      });

      let precisaRecalcular = true;

      if (ultimoScoreCalculado) {
        const diferencaMilissegundos = Date.now() - new Date(ultimoScoreCalculado.updatedAt).getTime();
        const diferencaMinutos = diferencaMilissegundos / (1000 * 60);

        // Se o último cálculo foi feito há menos de 10 minutos, pula o processamento pesado
        if (diferencaMinutos < COOLDOWN_MINUTES) {
          precisaRecalcular = false;
        }
      }

      if (precisaRecalcular) {
        console.log(`⚡ [Score Controller] Cooldown expirado ou inexistente. Rodando motor para o usuário: ${userId}`);
        await ScoreService.calcularEAtualizarScoresPorUsuario(userId);
      } else {
        console.log(`💾 [Score Controller] Servindo scores direto do cache do banco para o usuário: ${userId}`);
      }

      // Busca o dossiê completo mastigado (Rápido - Apenas leitura com SELECT)
      const clientsWithScores = await ScoreService.buscarClientesComScores(userId);
      
      return res.json(clientsWithScores);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * 🔄 RECÁLCULO MANUAL (BOTÃO DE FORÇAR ATUALIZAÇÃO)
   * Ignora travas temporais e força a execução imediata do motor de crédito
   */
  static async forceRecalculate(
    _req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const userId = auth.sub;

      // Força a execução sem nenhuma checagem de tempo
      await ScoreService.calcularEAtualizarScoresPorUsuario(userId);

      // Busca os novos dados consolidados
      const updatedClients = await ScoreService.buscarClientesComScores(userId);

      return res.status(200).json({
        success: true,
        message: "Análise de crédito e histórico de pagamentos reavaliados com sucesso.",
        data: updatedClients
      });
    } catch (e) {
      return next(e);
    }
  }
}
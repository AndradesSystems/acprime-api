import type { Request, Response, NextFunction } from "express";
import { NegotiationService } from "../services/negotiation.service";
import type { AuthPayload } from "../lib/jwt";
// import type { AuthPayload } from "../types/auth"; // Ajuste o caminho do seu tipo AuthPayload se necessário

const negotiationService = new NegotiationService();

export class NegotiationController {

    /**
     * POST /negotiations
     * Cria uma nova negociação para um contrato
     */
    async create(req: Request, res: Response, next: NextFunction, auth: AuthPayload) {
        try {
            const { contractId, valorDesconto, tipo, qtdParcelas, primeiroVencimento } = req.body;

            if (!contractId || !tipo || !primeiroVencimento) {
                return res.status(400).json({
                    error: 'Os campos contractId, tipo e primeiroVencimento são obrigatórios.'
                });
            }

            if (tipo === 'PARCELADO' && (!qtdParcelas || qtdParcelas < 1)) {
                return res.status(400).json({
                    error: 'Para negociações parceladas, a quantidade de parcelas deve ser informada e maior que 0.'
                });
            }

            const negotiation = await negotiationService.create({
                contractId,
                valorDesconto: Number(valorDesconto) || 0,
                tipo,
                qtdParcelas: tipo === 'PARCELADO' ? Number(qtdParcelas) : 1,
                primeiroVencimento: new Date(primeiroVencimento)
            });

            return res.status(201).json(negotiation);
        } catch (e) {
            return next(e);
        }
    }

    /**
     * PATCH /negotiations/installments/:id/pay
     */
    async payInstallment(req: Request, res: Response, next: NextFunction, auth: AuthPayload) {
        try {
            const { id } = req.params;
            if (!id || typeof id !== 'string') {
                return res.status(400).json({ error: "O ID do contrato é obrigatório." });
            }

            const result = await negotiationService.payInstallment(id);
            return res.json(result);
        } catch (e) {
            return next(e);
        }
    }

    /**
     * GET /negotiations/contract/:contractId
     */
    async getByContract(req: Request, res: Response, next: NextFunction, auth: AuthPayload) {
        try {
            const { contractId } = req.params;

            if (!contractId || typeof contractId !== 'string') {
                return res.status(400).json({ error: "O ID do contrato é obrigatório." });
            }

            const history = await negotiationService.getByContract(contractId);
            return res.json(history);
        } catch (e) {
            return next(e);
        }
    }

    /**
     * PATCH /negotiations/:id/break
     */
    async breakNegotiation(req: Request, res: Response, next: NextFunction, auth: AuthPayload) {
        try {
            const { id } = req.params;
            if (!id || typeof id !== 'string') {
                return res.status(400).json({ error: "O ID do contrato é obrigatório." });
            }

            const result = await negotiationService.breakNegotiation(id);
            return res.json(result);
        } catch (e) {
            return next(e);
        }
    }

    /* =========================================================
       📅 NEGOCIAÇÕES E RESUMOS DO PERÍODO (MÉTODOS NOVOS)
       ========================================================= */

    /**
     * GET /negotiations
     * Retorna a listagem de negociações do período pertencentes ao usuário logado
     */
    async get(req: Request, res: Response, next: NextFunction, auth: AuthPayload) {
        try {
            const { start, end } = req.query;

            if (!start || !end) {
                return res.status(400).json({ error: 'As query params "start" e "end" são obrigatórias.' });
            }

            const startDate = new Date(start as string);
            const endDate = new Date(end as string);

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                return res.status(400).json({ error: "Formato de data inválido." });
            }

            // ✅ Passando o auth.sub como o userId para garantir o isolamento
            const data = await negotiationService.get(auth.sub, startDate, endDate);
            
            return res.json(data);
        } catch (e) {
            return next(e); // ✅ Delega o erro para o seu AppError / Middleware Global
        }
    }

    /**
     * GET /negotiations/summary
     * Retorna o resumo financeiro (cards/gráficos) das negociações do usuário logado
     */
    async summary(req: Request, res: Response, next: NextFunction, auth: AuthPayload) {
        try {
            // ✅ Passando o auth.sub como o userId para as métricas do painel
            const metrics = await negotiationService.summary(auth.sub);
            
            return res.json(metrics);
        } catch (e) {
            return next(e); // ✅ Delega o erro para o seu AppError / Middleware Global
        }
    }
}
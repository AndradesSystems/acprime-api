import { Router } from "express";
import { withAuth } from "../middlewares/auth.wrapper"; // Importando seu wrapper de autenticação
import { NegotiationController } from "../controllers/negotiation.controller";

export const negotiationRoutes = Router();

const negotiationController = new NegotiationController();

/* =========================================================
   📥 CRIAÇÃO E PROCESSAMENTO
   ========================================================= */

// POST: Cria uma nova negociação para um contrato (À vista ou Parcelado)
negotiationRoutes.post(
  "", 
  withAuth(negotiationController.create)
);

/* =========================================================
   📅 FILTROS E DASHBOARD (NOVAS ROTAS)
   ========================================================= */

// GET: Listagem de todas as negociações do usuário filtradas por período (Query: start/end)
// Exemplo: GET /negotiations?start=2026-04-30...&end=2026-05-31...
negotiationRoutes.get(
  "", 
  withAuth(negotiationController.get)
);

// GET: Resumo financeiro consolidado de métricas para os gráficos do dashboard
// Exemplo: GET /negotiations/summary?start=2026-04-30...&end=2026-05-31...
negotiationRoutes.get(
  "/summary", 
  withAuth(negotiationController.summary)
);

/* =========================================================
   🔍 HISTÓRICO E AÇÕES COMPLEMENTARES
   ========================================================= */

// GET: Recupera o histórico completo de acordos feitos para aquele contrato específico
negotiationRoutes.get(
  "/contract/:contractId", 
  withAuth(negotiationController.getByContract)
);

// PATCH: Dá baixa no pagamento de uma parcela específica do acordo
negotiationRoutes.patch(
  "/installments/:id/pay", 
  withAuth(negotiationController.payInstallment)
);

// PATCH: Cancela/quebra um acordo por inadimplência das parcelas negociadas
negotiationRoutes.patch(
  "/:id/break", 
  withAuth(negotiationController.breakNegotiation)
);
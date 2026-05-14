import { Router } from "express";
import { PaymentController } from "../controllers/payment.controller";
import { withAuth } from "../middlewares/auth.wrapper";

const router = Router();

/* ===============================
    ✅ OPERAÇÕES DE PAGAMENTO
=============================== */

/** * 💰 QUITAÇÃO TOTAL (Payoff)
 * Rota para liquidar o contrato inteiro de uma vez sem timeout.
 */
router.post(
  "/contracts/:contractId/pay-full",
  withAuth(PaymentController.payFullContract),
);

/** * 💳 PAGAR PARCELA INDIVIDUAL
 * Rota para dar baixa em uma única parcela específica.
 */
router.post(
  "/installments/:installmentId/pay",
  withAuth(PaymentController.payInstallment),
);

/** * 📝 REGISTRO DE PAGAMENTO AVULSO
 * Abate automaticamente: Taxa -> Juros -> Principal.
 */
router.post("/contracts/:contractId", withAuth(PaymentController.create));

/* ===============================
    🔍 CONSULTAS E HISTÓRICO
=============================== */

router.get(
  "/contracts/:contractId",
  withAuth(PaymentController.listByContract),
);

router.delete("/:paymentId", withAuth(PaymentController.delete));

router.get(
  "/contracts/:contractId/history",
  withAuth(PaymentController.historyByContract),
);

/* ===============================
    🔥 FINANCEIRO (Dashboard)
    Retorna montantes precisos (Ex: R$ 1.820,00) e taxas.
=============================== */

router.get("/finance/summary", withAuth(PaymentController.financeSummary));

router.get("/finance/payments", withAuth(PaymentController.paymentsByPeriod));

export default router;

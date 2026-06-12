import { Router } from "express";
import { PaymentController } from "../controllers/payment.controller";
import { withAuth } from "../middlewares/auth.wrapper";

const router = Router();


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

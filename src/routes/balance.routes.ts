import { Router } from "express";
import { withAuth } from "../middlewares/auth.wrapper"; 
import { BalanceController } from "../controllers/balance.crontroller";

const router = Router();

// =========================================================
// 💰 ROTAS DE SALDO (BALANCE)
// =========================================================

// Consultar Saldo: GET /balance
router.get("/", withAuth(BalanceController.getBalance));

// 🆕 Consultar Histórico (Extrato): GET /balance/history
router.get("/history", withAuth(BalanceController.getHistory));

// Aporte (Entrada): POST /balance/deposit
router.post("/deposit", withAuth(BalanceController.addBalance));

// Sangria (Retirada): POST /balance/withdraw
router.post("/withdraw", withAuth(BalanceController.removeBalance));

export default router;
import { Router } from "express";
import authRoutes from "./auth.routes";
import dashboardRoutes from "./dashboard.routes";

import userRoutes from "./user.routes";
import balanceRoutes from "./balance.routes";
import backupRoutes from "./backup.routes";

import clientRoutes from "./client.routes";
import contractRoutes from "./contract.routes";
import paymentRoutes from "./payment.routes";
import { financeRoutes } from "./finance.routes";
import { whatsappRoutes } from "./whatsapp.routes"; // Importando as novas rotas do WhatsApp
import { withAdmin } from "../middlewares/auth.wrapper";
import taxaRoutes from "./taxa.routes";
import scoreRoutes from './score.routes'

const router = Router();

router.use("/auth", authRoutes);

router.use("/balance", balanceRoutes);
router.use("/backup", backupRoutes);

router.use("/dashboard", dashboardRoutes);
router.use("/users", userRoutes);
router.use("/finance", financeRoutes);
router.use("/client", clientRoutes);
router.use("/score", scoreRoutes);
router.use("/contract", contractRoutes);
router.use("/taxas", taxaRoutes);
router.use("/payment", paymentRoutes);
router.use("/whatsapp", whatsappRoutes);


export default router;
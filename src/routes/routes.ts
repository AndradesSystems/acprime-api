import { Router } from "express";
import authRoutes from "./auth.routes";
import dashboardRoutes from "./dashboard.routes";

import userRoutes from "./user.routes";
import balanceRoutes from "./balance.routes";

import clientRoutes from "./client.routes";
import contractRoutes from "./contract.routes";
import paymentRoutes from "./payment.routes";
import { financeRoutes } from "./finance.routes";
import { BackupController } from "../controllers/backup.controller";
import { withAdmin } from "../middlewares/auth.wrapper";
import taxaRoutes from "./taxa.routes";




const router = Router();

router.use("/auth", authRoutes);

// Rota para o botão de Backup
router.get("/admin/backup/download", BackupController.download);

// Rota para o botão de Importar
router.post("/admin/backup/restore", BackupController.restore);

router.use("/balance", balanceRoutes);

router.use("/dashboard", dashboardRoutes);
router.use("/users", userRoutes);
router.use("/finance", financeRoutes);
router.use("/client", clientRoutes);
router.use("/contract", contractRoutes);
router.use("/taxas", taxaRoutes);
router.use("/payment", paymentRoutes);


export default router;

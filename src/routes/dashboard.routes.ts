import { Router } from "express";
import { DashboardController } from "../controllers/dashboard.controller";
import { withAuth } from "../middlewares/auth.wrapper";

const router = Router();

/**
 * GET /dashboard/summary
 * Retorna todos os dados do dashboard
 */
router.get("/summary", withAuth(DashboardController.summary));

export default router;

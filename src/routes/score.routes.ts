import { Router } from "express";
import { withAuth } from "../middlewares/auth.wrapper";
import { ScoreController } from "../controllers/score.constroller";

const router = Router();

// GET: Retorna todos os clientes do usuário já trazendo o model clientScore em cada um
router.get("/clients", withAuth(ScoreController.listAllWithScores));

// POST: Força o motor de crédito a rodar e atualizar o banco de dados instantaneamente
router.post("/recalculate", withAuth(ScoreController.forceRecalculate));

export default router;
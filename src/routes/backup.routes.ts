import { Router } from "express";
import { BackupController } from "../controllers/backup.controller";
import { withAuth } from "../middlewares/auth.wrapper";

const router = Router();

// GET: Exportação (Total ou Segmentada via query: ?type=CLIENTES)
router.get("/export", withAuth(BackupController.export));

// POST: Importação / Restauração de dados
router.post("/import", withAuth(BackupController.import));

export default router;
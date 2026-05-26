import { Router } from "express";
import { ClientController } from "../controllers/client.controller";
import { withAuth } from "../middlewares/auth.wrapper";
import { uploadMiddleware } from "../config/cloudinary";

const router = Router();

// POST: Processa até 5 imagens no campo 'documentos' e depois autentica/executa o controller
router.post("/", uploadMiddleware.array("documentos", 5), withAuth(ClientController.create));

// GETs: Rotas de leitura comuns (não utilizam arquivos, logo não precisam do multer)
router.get("/", withAuth(ClientController.list));

// 🟢 NOVA ROTA: Quadro de Caloteiros geral do sistema
// Nota: Ela PRECISA vir antes de "/:id" para o Express não achar que "caloteiros" é um ID de cliente.
router.get("/caloteiros", withAuth(ClientController.listCaloteiros));

router.get("/:id", withAuth(ClientController.getById));

// PUT: Permite atualizar dados textuais e opcionalmente enviar novos arquivos substituindo os antigos
router.put("/:id", uploadMiddleware.array("documentos", 5), withAuth(ClientController.update));

// Rota PATCH para atualizar parcialmente o status do contrato
router.patch("/contracts/:id/toggle-caloteiro", withAuth(ClientController.toggleCaloteiroController));

// DELETE: Remoção direta estruturada
router.delete("/:id", withAuth(ClientController.remove));

export default router;
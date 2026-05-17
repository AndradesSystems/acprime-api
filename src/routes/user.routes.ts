import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { withAdmin } from "../middlewares/auth.wrapper";

const router = Router();

// Rota original para criar o primeiro Admin (geralmente pública ou protegida por chave secreta)
router.post("/admin", UserController.createAdmin);

// Rota original para criar Operadores (comum para quem já é Admin)
router.post("/", withAdmin(UserController.createUser));

// --- NOVAS ROTAS (Substituem as do antigo Subscriber) ---

// Listar assinantes: GET /users/assinantes
router.get("/assinantes", (UserController.listAssinantes));

// Criar assinante: POST /users/assinantes
router.post("/assinantes", withAdmin(UserController.createAssinante));

// Gestão por ID: GET, PUT e DELETE /users/:id
router.get("/:id", withAdmin(UserController.getById));
router.put("/:id", withAdmin(UserController.update));
router.delete("/:id", withAdmin(UserController.delete));

export default router;
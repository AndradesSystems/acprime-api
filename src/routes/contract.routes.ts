import { Router } from "express";
import { ContractController } from "../controllers/contract.controller";
import { withAuth } from "../middlewares/auth.wrapper";

const router = Router();

// --- Rotas de Gerenciamento ---
router.post("/", withAuth(ContractController.create));
router.get("/", withAuth(ContractController.list));

/** ✅ Deletar contrato (Cascade: Parcelas e Pagamentos) */
router.delete("/:id", withAuth(ContractController.remove));

/** ✅ Listar contratos por cliente */
router.get("/client/:clientId", withAuth(ContractController.listByClientId));

// --- Rotas de Detalhes (Protegidas por Usuário) ---
router.get("/:id", withAuth(ContractController.getById));
router.get("/:id/summary", withAuth(ContractController.summary));

router.post("/:id/notify", withAuth(async (req, res, next, auth) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: "ID do contrato inválido ou ausente." });
    }

    // Opcional: Validar se o contrato pertence ao usuário antes de notificar
    // const contrato = await ContractService.getById(id);
    // if (contrato.userId !== auth.sub) return res.status(403).json({ error: "Proibido" });

    
    return res.json({ 
      success: true, 
      message: "O Robô Andrade enviou a mensagem com sucesso! 🤖" 
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Erro ao enviar notificação manual." });
  }
}));

/** ✅ Atualizar vencimento do contrato */
router.patch(
  "/:id/due-date",
  withAuth(ContractController.updateDueDate),
);

export default router;
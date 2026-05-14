import { Router } from "express";
import { ClientController } from "../controllers/client.controller";
import { withAuth } from "../middlewares/auth.wrapper";

const router = Router();

router.post("/", withAuth(ClientController.create));
router.get("/", withAuth(ClientController.list));
router.get("/:id", withAuth(ClientController.getById));
router.put("/:id", withAuth(ClientController.update));
router.delete("/:id", withAuth(ClientController.remove));

export default router;

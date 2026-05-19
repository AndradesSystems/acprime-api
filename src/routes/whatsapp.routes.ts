import { Router } from "express";
import { WhatsAppController } from "../controllers/whatsapp.controller"; 
import { withAuth } from "../middlewares/auth.wrapper";

export const whatsappRoutes = Router();

/* ==========================================================================
   WHATSAPP / INSTANCE MANAGEMENT & CONNECTION
   ========================================================================== */

/**
 * 1. Conexão e QR Code
 * Retorna o Base64 do QR Code para o usuário logado escanear
 * GET /whatsapp/qrcode
 */
whatsappRoutes.get(
  "/qrcode", 
  withAuth(WhatsAppController.getQrCode)
);

/* ==========================================================================
   WHATSAPP / MESSAGING OPERATIONS
   ========================================================================== */

/**
 * 2. Envio de Mensagens Textuais
 * Dispara uma mensagem usando a instância do usuário logado como remetente
 * POST /whatsapp/send
 */
whatsappRoutes.post(
  "/send", 
  withAuth(WhatsAppController.sendMessage)
);
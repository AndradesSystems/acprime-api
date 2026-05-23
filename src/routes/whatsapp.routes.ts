import { Router } from "express";
import { WhatsAppController } from "../controllers/whatsapp.controller"; 
import { withAuth } from "../middlewares/auth.wrapper";

export const whatsappRoutes = Router();

/* ==========================================================================
   WHATSAPP / INSTANCE MANAGEMENT & CONNECTION
   ========================================================================== */

/**
 * 1. Inicializar Motor do WhatsApp
 * Acorda e ergue o socket do Baileys para o usuário autenticado na RAM.
 * POST /api/whatsapp/connect
 */
whatsappRoutes.post(
  "/connect", 
  withAuth(WhatsAppController.connect)
);

/**
 * 2. Monitoramento de Conexão e QR Code
 * Retorna o status atual ('CONNECTING', 'QRCODE', 'OPEN', 'CLOSED') 
 * e entrega a string de texto do QR Code para o front-end desenhar.
 * GET /api/whatsapp/status
 */
whatsappRoutes.get(
  "/status", 
  withAuth(WhatsAppController.getStatus)
);

/**
 * 🟢 4. Desconectar e Matar Instância
 * Desconecta o WhatsApp, encerra o processo na memória RAM e limpa as credenciais do banco.
 * POST /api/whatsapp/disconnect
 */
whatsappRoutes.post(
  "/disconnect", 
  withAuth(WhatsAppController.disconnect)
);

/* ==========================================================================
   WHATSAPP / MESSAGING OPERATIONS
   ========================================================================== */

/**
 * 3. Envio de Mensagens Textuais
 * Dispara uma mensagem usando a instância ativa do usuário logado como remetente
 * POST /api/whatsapp/send
 */
whatsappRoutes.post(
  "/send", 
  withAuth(WhatsAppController.sendMessage)
);
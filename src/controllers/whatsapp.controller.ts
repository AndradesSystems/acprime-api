import { type Request, type Response, type NextFunction } from "express";
import { WhatsAppService } from "../services/whatsapp.service";
import { type AuthPayload } from "../lib/jwt";

export class WhatsAppController {
  
  /**
   * POST /api/whatsapp/connect
   * Liga o motor do WhatsApp (Baileys) para o usuário logado.
   * Disparado quando o usuário clica no botão "Conectar WhatsApp" no painel.
   */
  static async connect(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const userId = auth.sub;

      if (!userId) {
        return res.status(401).json({ error: "Usuário não autenticado." });
      }

      // Dispara a inicialização do socket em background
      WhatsAppService.conectarWhatsApp(String(userId));

      return res.status(200).json({ 
        success: true, 
        message: "Inicializando motor do WhatsApp. Busque o status para obter o QR Code." 
      });
    } catch (e) {
      return next(e);
    }
  }

  /**
   * GET /api/whatsapp/status
   * Retorna o estado atual da conexão ('CONNECTING', 'QRCODE', 'OPEN', 'CLOSED') 
   * e entrega a string do QR Code caso ela exista na memória RAM.
   */
  static async getStatus(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const userId = auth.sub; 

      if (!userId) {
        return res.status(401).json({ error: "Usuário não autenticado." });
      }

      // Busca o status atual do objeto global na memória RAM através do Service
      const statusWhatsApp = await WhatsAppService.getStatus(String(userId));

      // Devolve o JSON completo para o front-end tomar as decisões de interface
      return res.status(200).json({ 
        success: true, 
        data: statusWhatsApp 
      });
    } catch (e) {
      return next(e);
    }
  }

  /**
   * POST /api/whatsapp/send
   * Dispara uma mensagem usando a instância ativa do usuário logado na RAM
   */
  static async sendMessage(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const userId = auth.sub;
      const { phone, message } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Usuário não autenticado." });
      }

      // Validação dos campos obrigatórios do corpo da requisição
      if (!phone || !message) {
        return res.status(400).json({ error: "Telefone e mensagem são obrigatórios." });
      }

      // Dispara o envio checando o JID correto através do Baileys
      const result = await WhatsAppService.sendMessage(String(userId), phone, message);

      return res.status(200).json({ 
        success: true, 
        message: "Mensagem enviada com sucesso!",
        data: result 
      });
    } catch (e) {
      return next(e);
    }
  }

  /**
   * 🟢 NOVO: POST /api/whatsapp/disconnect
   * Desconecta o WhatsApp da tomada, limpa a memória RAM e zera as credenciais no banco.
   * Disparado quando o usuário clica em "Desconectar" ou "Sair" na interface.
   */
  static async disconnect(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const userId = auth.sub;

      if (!userId) {
        return res.status(401).json({ error: "Usuário não autenticado." });
      }

      // Executa a limpa completa no banco e na memória
      await WhatsAppService.desconectarWhatsApp(String(userId));

      return res.status(200).json({ 
        success: true, 
        message: "WhatsApp desconectado com sucesso e credenciais removidas do servidor." 
      });
    } catch (e) {
      return next(e);
    }
  }
}
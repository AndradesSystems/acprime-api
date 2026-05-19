import { type Request, type Response, type NextFunction } from "express";
import { WhatsAppService } from "../services/whatsapp.service";
import { type AuthPayload } from "../lib/jwt";

export class WhatsAppController {
  
  /**
   * GET /api/whatsapp/qrcode
   * Busca ou gera o QR Code para o usuário logado escanear
   */
  static async getQrCode(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      // 🟢 Ajustado: Pega o ID único do usuário logado via payload do JWT (auth.sub)
      const userId = auth.sub; 

      if (!userId) {
        return res.status(401).json({ error: "Usuário não autenticado." });
      }

      // Chama o método do serviço da Evolution API
      const base64QrCode = await WhatsAppService.getQrCode(userId);

      // Devolve o Base64 pronto para o seu front-end renderizar
      return res.status(200).json({ 
        success: true, 
        qrcode: base64QrCode 
      });
    } catch (e) {
      // 🟢 Ajustado: Segue o padrão do seu projeto repassando o erro para o middleware global
      return next(e);
    }
  }

  /**
   * POST /api/whatsapp/send
   * Dispara uma mensagem usando a instância do usuário logado
   */
  static async sendMessage(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      // 🟢 Ajustado: Pega o ID único do usuário logado via payload do JWT (auth.sub)
      const userId = auth.sub;
      const { phone, message } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Usuário não autenticado." });
      }

      // Validação básica dos campos obrigatórios
      if (!phone || !message) {
        return res.status(400).json({ error: "Telefone e mensagem são obrigatórios." });
      }

      // Dispara a mensagem passando o ID do usuário como referência da instância
      const result = await WhatsAppService.sendMessage(userId, phone, message);

      return res.status(200).json({ 
        success: true, 
        message: "Mensagem enviada com sucesso!",
        data: result 
      });
    } catch (e) {
      return next(e);
    }
  }
}
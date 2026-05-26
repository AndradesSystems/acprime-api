import { type Request, type Response, type NextFunction } from "express";
import { ClientService } from "../services/client.service";
import { type AuthPayload } from "../lib/jwt";
import { uploadToCloudinary } from "../config/cloudinary";

export class ClientController {
  static async create(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      // 1. Recupera as imagens processadas pelo Multer na memória RAM (pode ser undefined se não enviado)
      const files = req.files as Express.Multer.File[] | undefined;
      const imageUrls: string[] = [];

      // 2. Se houverem arquivos enviados, faz o upload iterativo para o Cloudinary
      if (files && files.length > 0) {
        for (const file of files) {
          const url = await uploadToCloudinary(file.buffer, `sistema_cobranca/user_${auth.sub}`);
          imageUrls.push(url);
        }
      }

      // 3. Passa os dados textuais do formulário e o array de URLs (vazio ou preenchido) para o Service
      const client = await ClientService.create({
        ...req.body,
        userId: auth.sub,
        images: imageUrls.length > 0 ? imageUrls : undefined, // Fica opcional se não houver imagens
      });

      return res.status(201).json(client);
    } catch (e) {
      return next(e);
    }
  }

  static async list(
    _req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const clients = await ClientService.list(auth.sub);
      return res.json(clients);
    } catch (e) {
      return next(e);
    }
  }



  static async getById(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do cliente é obrigatório." });
      }

      const client = await ClientService.getById(id, auth.sub);
      return res.json(client);
    } catch (e) {
      return next(e);
    }
  }

  static async update(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do cliente é obrigatório." });
      }

      const files = req.files as Express.Multer.File[] | undefined;
      const updatePayload = { ...req.body };

      // Se o usuário incluiu novos arquivos no update, processa e substitui as imagens
      if (files && files.length > 0) {
        const imageUrls: string[] = [];
        for (const file of files) {
          const url = await uploadToCloudinary(file.buffer, `sistema_cobranca/user_${auth.sub}`);
          imageUrls.push(url);
        }
        updatePayload.images = imageUrls;
      }

      const updatedClient = await ClientService.update(
        id,
        auth.sub,
        updatePayload
      );

      return res.json(updatedClient);
    } catch (e) {
      return next(e);
    }
  }

  static async remove(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do cliente é obrigatório." });
      }

      await ClientService.remove(id, auth.sub);
      return res.status(204).send();
    } catch (e) {
      return next(e);
    }
  }







  // 🟢 NOVO MÉTODO: Listagem do Quadro de Caloteiros geral do sistema
  static async listCaloteiros(
    _req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      // 💡 [ESPAÇO RESERVADO]: Faça a validação do plano aqui se preferir.
      // Exemplo:
      // const temAcesso = await UserService.checkPremiumPlan(auth.sub);
      // if (!temAcesso) return res.status(403).json({ error: "Recurso exclusivo do plano Premium." });

      const caloteiros = await ClientService.listCaloteiros(auth.sub);
      return res.json(caloteiros);
    } catch (e) {
      return next(e);
    }
  }

  static async toggleCaloteiroController(req: Request, res: Response) {
    try {
      const { id } = req.params; // ID do contrato vindo da URL
      const { acao } = req.body; // "MANDAR_PRO_QUADRO" ou "TIRAR_DO_QUADRO"


      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do cliente é obrigatório." });
      }

      // Validação simples da ação recebida
      if (acao !== "MANDAR_PRO_QUADRO" && acao !== "TIRAR_DO_QUADRO") {
        return res.status(400).json({
          error: "Ação inválida. Use 'MANDAR_PRO_QUADRO' ou 'TIRAR_DO_QUADRO'."
        });
      }

      // Chama o método do Prisma que criamos antes
      const contratoAtualizado = await ClientService.toggleCaloteiroStatus(id, acao);

      return res.status(200).json(contratoAtualizado);
    } catch (error: any) {
      console.error("Erro no toggleCaloteiroController:", error);
      return res.status(500).json({ error: "Erro interno ao atualizar status de caloteiro." });
    }
  }
}
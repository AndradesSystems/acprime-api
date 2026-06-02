import { type Request, type Response, type NextFunction } from "express";
import { UserService } from "../services/user.service";
import { type AuthPayload } from "../lib/jwt";

export class UserController {
  /* =========================================================
        🚀 CRIAÇÃO DE USUÁRIOS
     ========================================================= */

  // Criar Administrador
  static async createAdmin(req: Request, res: Response) {
    const { nome, cpf, email, senha } = req.body;
    const user = await UserService.createUser({
      nome,
      cpf,
      email,
      senha,
      tipo: "ADMIN"
    });
    return res.status(201).json(user);
  }

  // Criar Operador (Dentro de um contexto de Admin)
  static async createUser(req: Request, res: Response, _next: NextFunction, auth: AuthPayload) {
    const { nome, cpf, email, senha } = req.body;
    const user = await UserService.createUser({
      nome,
      cpf,
      email,
      senha,
      tipo: "OPERADOR"
    });
    return res.status(201).json(user);
  }

  // Criar Assinante (Fluxo de teste gratuito ou criação padrão)
  static async createAssinante(req: Request, res: Response) {
    const { nome, cpf, email, senha, diasValidade, plan } = req.body;

    // 💡 Cria o usuário com plano VAZIO e vencimento null (relógio parado)
    let user = await UserService.createUser({
      nome,
      cpf,
      email,
      senha,
      tipo: "ASSINANTE"
    });

    // 🌟 Caso o Admin esteja criando um assinante que JÁ PAGOU antes de acessar
    // Nós aproveitamos o método updateUser para injetar os dias e o plano contratado.
    if (diasValidade || plan) {
      user = await UserService.updateUser(user.id, {
        diasValidade,
        plan: plan || "STARTER" 
      });
    }

    return res.status(201).json(user);
  }

  /* =========================================================
        🔍 CONSULTAS
     ========================================================= */

  // Listar Assinantes
  static async listAssinantes(req: Request, res: Response) {
    const users = await UserService.listByTipo("ASSINANTE");
    return res.json(users);
  }

  // Buscar Usuário por ID
  static async getById(req: Request, res: Response) {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: "O ID do usuário é obrigatório." });
    }

    const user = await UserService.findById(id);

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    return res.json(user);
  }

  /* =========================================================
        🔄 MANUTENÇÃO (UPDATE / DELETE)
     ========================================================= */

  /**
   * Atualizar Usuário
   * Suporta:
   * - Troca de senha
   * - Troca de plano (enviando plan: "STARTER" | "PRO")
   * - Bloqueio manual (enviando status: "BLOQUEADO")
   * - Renovação (enviando diasValidade: 30)
   */
  static async update(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "ID do usuário é obrigatório para atualização." });
      }

      const user = await UserService.updateUser(id, req.body);
      return res.json(user);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }

  // Deletar Usuário
  static async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "ID do usuário é obrigatório." });
      }

      await UserService.deleteUser(id);

      return res.status(204).send();
    } catch (error: any) {
      return res.status(400).json({ error: "Erro ao deletar usuário" });
    }
  }
}
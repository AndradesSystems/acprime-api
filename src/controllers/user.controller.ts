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

  // Criar Assinante (Painel Geral com controle de validade)
  static async createAssinante(req: Request, res: Response) {
    const { nome, cpf, email, senha, diasValidade } = req.body;

    // Define a data de vencimento inicial
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + (diasValidade || 30));

    const user = await UserService.createUser({
      nome,
      cpf,
      email,
      senha,
      tipo: "ASSINANTE",
      vencimento
    });
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
   * - Bloqueio manual (enviando status: "BLOQUEADO")
   * - Renovação (enviando diasValidade)
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
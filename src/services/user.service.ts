import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";

export class UserService {
  // Criar Usuário (Admin, Operador ou Assinante)
  static async createUser(data: { 
    nome: string; 
    cpf: string; 
    email: string; 
    senha: string; 
    tipo: "ADMIN" | "OPERADOR" | "ASSINANTE";
    vencimento?: Date;
  }) {
    const senhaHash = await bcrypt.hash(data.senha, 10);

    const user = await prisma.user.create({
      data: {
        nome: data.nome,
        cpf: data.cpf,
        email: data.email,
        senhaHash,
        tipo: data.tipo as any,
        vencimento: data.vencimento || null,
        status: "ATIVO", // Inicia como ativo por padrão
      },
    });

    return { 
      id: user.id, 
      nome: user.nome, 
      email: user.email, 
      tipo: user.tipo, 
      vencimento: user.vencimento,
      status: user.status 
    };
  }

  // Buscar por ID
  static async findById(id: string) {
    return await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        cpf: true,
        email: true,
        tipo: true,
        vencimento: true,
        status: true, // Adicionado para o front poder exibir/gerenciar
        createdAt: true,
      }
    });
  }

  // Listar por Tipo
  static async listByTipo(tipo: "ASSINANTE" | "OPERADOR") {
    return await prisma.user.findMany({
      where: { tipo: tipo as any },
      orderBy: { nome: "asc" }
    });
  }

  // Atualizar Usuário com lógica de renovação
  static async updateUser(id: string, data: any) {
    const { senha, diasValidade, ...rest } = data;
    const updateData: any = { ...rest };

    // Se enviar senha, gera novo hash
    if (senha) {
      updateData.senhaHash = await bcrypt.hash(senha, 10);
    }

    // Se enviar diasValidade, calcula novo vencimento (Renovação)
    if (diasValidade) {
      // Lógica de acúmulo: se já tem vencimento futuro, soma a partir de lá
      const userAtual = await prisma.user.findUnique({ where: { id } });
      const dataBase = (userAtual?.vencimento && userAtual.vencimento > new Date()) 
        ? userAtual.vencimento 
        : new Date();

      const novoVencimento = new Date(dataBase);
      novoVencimento.setDate(novoVencimento.getDate() + diasValidade);
      
      updateData.vencimento = novoVencimento;
      updateData.status = "ATIVO"; // Se estava bloqueado por atraso, reativa ao renovar
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    return { 
      id: user.id, 
      nome: user.nome, 
      email: user.email, 
      tipo: user.tipo, 
      vencimento: user.vencimento,
      status: user.status 
    };
  }

 static async validateAccess(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new Error("Usuário não encontrado.");
    }

    // 1. Se for ADMIN, passa direto sem olhar nada
    if (user.tipo === "ADMIN") return user;

    // 2. Bloqueio Manual (Status)
    if (user.status === "BLOQUEADO") {
      throw new Error("Sua conta está bloqueada.");
    }

    // 3. Bloqueio por Vencimento (Apenas para Assinantes)
    if (user.tipo === "ASSINANTE" && user.vencimento) {
      const hoje = new Date();
      // Zeramos as horas para comparar apenas os dias, evitando erros de milissegundos
      hoje.setHours(0, 0, 0, 0);
      
      const dataVencimento = new Date(user.vencimento);
      dataVencimento.setHours(23, 59, 59, 999); // Garante que vale até o último segundo do dia

      if (hoje > dataVencimento) {
        throw new Error("Sua assinatura expirou.");
      }
    }

    return user;
  }

  static async findByEmail(email: string) {
    return await prisma.user.findUnique({
      where: { email }
    });
  }

  static async deleteUser(id: string) {
    return await prisma.user.delete({
      where: { id }
    });
  }
}
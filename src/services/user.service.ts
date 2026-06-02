import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";

export class UserService {
  static async createUser(data: {
    nome: string;
    cpf: string;
    email: string;
    senha: string;
    tipo: "ADMIN" | "OPERADOR" | "ASSINANTE";
  }) {
    const senhaHash = await bcrypt.hash(data.senha, 10);

    const user = await prisma.user.create({
      data: {
        nome: data.nome,
        cpf: data.cpf,
        email: data.email,
        senhaHash,
        tipo: data.tipo,
        vencimento: null, // 💡 Começa nulo. O relógio ainda não está correndo!
        status: "ATIVO",
        plan: "VAZIO", // 💡 Perfeito! Indica que nunca acessou o sistema.
      },
    });

    return {
      id: user.id,
      nome: user.nome,
      email: user.email,
      tipo: user.tipo,
      vencimento: user.vencimento,
      status: user.status,
      plan: user.plan
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
        status: true,
        plan: true, // 🟢 Adicionado para o front saber o plano atual
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

  // Atualizar Usuário com lógica de renovação (Usado pelo Admin)
  static async updateUser(id: string, data: any) {
    const { senha, diasValidade, plan, ...rest } = data;
    const updateData: any = { ...rest };

    if (senha) {
      updateData.senhaHash = await bcrypt.hash(senha, 10);
    }

    // 🟢 Garante que se o admin enviar o plano (STARTER ou PRO), ele seja atualizado
    if (plan) {
      updateData.plan = plan;
    }

    // Se enviar diasValidade, calcula novo vencimento (Renovação de 30 dias, por exemplo)
    if (diasValidade) {
      const userAtual = await prisma.user.findUnique({ where: { id } });

      // Lógica de acúmulo: se já tem vencimento futuro, soma a após ele. Se não, soma a partir de hoje.
      const dataBase = (userAtual?.vencimento && userAtual.vencimento > new Date())
        ? userAtual.vencimento
        : new Date();

      const novoVencimento = new Date(dataBase);
      novoVencimento.setDate(novoVencimento.getDate() + diasValidade);

      updateData.vencimento = novoVencimento;
      updateData.status = "ATIVO"; // 💡 Garante que volta a ficar ATIVO após o pagamento
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
      status: user.status,
      plan: user.plan
    };
  }

  // 🛡️ O coração da validação de acesso e travas do sistema
  static async validateAccess(email: string) {
    // 💡 Buscando também o campo 'plan' que é crucial agora
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

    // 3. Usuário já caiu na trava anteriormente
    if (user.status === "AGUARDANDO_PAGAMENTO") {
      throw new Error("Sua assinatura expirou. Escolha um plano para continuar.");
    }

    // 4. 🌟 LÓGICA DO PRIMEIRO ACESSO (Apenas para Assinantes)
    if (user.tipo === "ASSINANTE" && user.plan === "VAZIO" && !user.vencimento) {
      const doisDiasNoFuturo = new Date();
      doisDiasNoFuturo.setDate(doisDiasNoFuturo.getDate() + 2);

      // Atualiza apenas o vencimento, mantendo o plano intocado (ou seja, VAZIO)
      const userAtualizado = await prisma.user.update({
        where: { id: user.id },
        data: {
          vencimento: doisDiasNoFuturo,
          // plan: "STARTER" 👈 REMOVIDO DAQUI para nunca mudar sozinho!
        }
      });

      return userAtualizado;
    }

    // 5. 🚨 CHECAGEM PADRÃO DE VENCIMENTO (Acessos normais pós-primeiro acesso)
    if (user.tipo === "ASSINANTE" && user.vencimento) {
      const hoje = new Date();

      // Se a data/hora atual passou do vencimento permitido
      if (hoje > new Date(user.vencimento)) {
        // Atualiza o status para travar os próximos acessos direto no Passo 3
        await prisma.user.update({
          where: { id: user.id },
          data: { status: "AGUARDANDO_PAGAMENTO" }
        });

        throw new Error("Sua assinatura expirou. Escolha um plano para continuar.");
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
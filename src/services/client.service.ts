import { prisma } from "../lib/prisma";
import { AppError } from "../middlewares/error.middleware";

type CreateClientDTO = {
  nome: string;
  cpf: string;
  telefone: string;
  email?: string;
  dataNascimento?: string;
  endereco?: string;
  userId: string; // Vem do token via Controller
};

export class ClientService {
  static async create(data: CreateClientDTO) {
    try {
      return await prisma.client.create({
        data: {
          nome: data.nome,
          cpf: data.cpf,
          telefone: data.telefone,
          email: data.email ?? null,
          dataNascimento: data.dataNascimento ? new Date(data.dataNascimento) : null,
          userId: data.userId,
        },
      });
    } catch {
      throw new AppError("CPF ou email já cadastrado", 409);
    }
  }

  static async list(userId: string) {
    return prisma.client.findMany({
      where: { userId },
      include: { contracts: true },
      orderBy: { createdAt: "desc" },
    });
  }

  static async getById(id: string, userId: string) {
    const client = await prisma.client.findFirst({
      where: { id, userId },
      include: { contracts: true },
    });

    if (!client) {
      throw new AppError("Cliente não encontrado", 404);
    }

    return client;
  }

  static async update(id: string, userId: string, data: Partial<Omit<CreateClientDTO, "userId">>) {
    await this.getById(id, userId);

    const updateData: any = {};

    if (data.nome !== undefined) updateData.nome = data.nome;
    if (data.cpf !== undefined) updateData.cpf = data.cpf;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.telefone !== undefined) updateData.telefone = data.telefone;
    if (data.endereco !== undefined) updateData.endereco = data.endereco;

    if (data.dataNascimento) {
      updateData.dataNascimento = new Date(data.dataNascimento);
    } else if (data.dataNascimento === null) {
      updateData.dataNascimento = null;
    }

    return prisma.client.update({
      where: { id },
      data: updateData,
    });
  }

  static async remove(id: string, userId: string) {
    await this.getById(id, userId); // Valida posse
    await prisma.client.delete({ where: { id } });
  }
}
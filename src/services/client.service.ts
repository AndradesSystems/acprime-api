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
  images?: string[]; // 🟢 Propriedade opcional: URLs do Cloudinary
};

export class ClientService {
  /**
   * 🟢 CRIAÇÃO DE CLIENTE: Cria o registro associando as imagens (se enviadas)
   * Se nenhuma imagem for passada, inicializa com um array vazio [] no Postgres.
   */
  static async create(data: CreateClientDTO) {
    try {
      return await prisma.client.create({
        data: {
          nome: data.nome,
          cpf: data.cpf,
          telefone: data.telefone,
          email: data.email ?? null,
          dataNascimento: data.dataNascimento ? new Date(data.dataNascimento) : null,
          endereco: data.endereco ?? "Não informado",
          userId: data.userId,
          images: data.images ?? [],
          score: "0"
        },
      });
    } catch (error) {
      throw new AppError("CPF ou email já cadastrado", 409);
    }
  }

  /**
   * 🟢 LISTAGEM: Retorna todos os clientes pertencentes ao usuário autenticado
   */
  static async list(userId: string) {
    return prisma.client.findMany({
      where: { userId },
      include: { contracts: true },
      orderBy: { createdAt: "desc" },
    });
  }

   /**
   * 🟢 LISTAGEM: Retorna todos os clientes CALOTEIROS
   */
  static async listCaloteiros(userId: string) {
    // Nota: O 'userId' está disponível para a sua validação de plano/assinatura posterior.

    return prisma.client.findMany({
      where: {
        contracts: {
          some: {
            status: "CALOTEIRO",
          },
        },
      },
      include: {
        // Trazemos apenas os contratos que estão marcados como calote
        contracts: {
          where: {
            status: "CALOTEIRO",
          },
        },
      },
      orderBy: {
        nome: "asc",
      },
    });
  }

  /**
 * 🔄 CONTROLE DE QUADRO: Força para CALOTEIRO ou remove regressando para ATRASADO
 */
static async toggleCaloteiroStatus(contractId: string, acao: "MANDAR_PRO_QUADRO" | "TIRAR_DO_QUADRO") {
  
  // Se a ação for mandar pro quadro, o status vira CALOTEIRO.
  // Se for para tirar do quadro, ele volta obrigatoriamente a ser apenas um contrato ATRASADO.
  const novoStatus = acao === "MANDAR_PRO_QUADRO" ? "CALOTEIRO" : "ATRASADO";

  return prisma.contract.update({
    where: {
      id: contractId,
    },
    data: {
      status: novoStatus,
    },
    include: {
      client: true, // Retorna junto os dados do cliente atualizados
    },
  });
}

  /**
   * 🟢 BUSCA POR ID: Retorna um cliente específico validando a posse pelo userId
   */
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

  /**
   * 🟢 ATUALIZAÇÃO: Atualiza os dados cadastrais e permite a substituição do array de fotos
   */
  static async update(id: string, userId: string, data: Partial<Omit<CreateClientDTO, "userId">>) {
    // Valida se o cliente existe e pertence ao usuário logado antes de atualizar
    await this.getById(id, userId);

    const updateData: any = {};

    if (data.nome !== undefined) updateData.nome = data.nome;
    if (data.cpf !== undefined) updateData.cpf = data.cpf;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.telefone !== undefined) updateData.telefone = data.telefone;
    if (data.endereco !== undefined) updateData.endereco = data.endereco;
    if (data.images !== undefined) updateData.images = data.images;

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

  /**
   * 🟢 REMOÇÃO: Deleta o cliente do banco de dados (valida posse primeiro)
   */
  static async remove(id: string, userId: string) {
    await this.getById(id, userId);
    await prisma.client.delete({ where: { id } });
  }

  /**
   * 🟢 ADICIONAR IMAGENS EXTRAS: Anexa novas fotos no histórico do banco de dados
   * sem apagar ou substituir as URLs antigas que já foram enviadas.
   */
  static async addImages(id: string, userId: string, newImageUrls: string[]) {
    await this.getById(id, userId);

    return prisma.client.update({
      where: { id },
      data: {
        images: {
          push: newImageUrls,
        },
      },
    });
  }
}
import type { ContractPeriodicity } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import { AppError } from "../middlewares/error.middleware";

type UpdateTaxaDTO = {
  type: ContractPeriodicity;
  value: number;
};

export class TaxaService {
  /**
   * Lista todas as taxas cadastradas
   */
  static async list() {
    return await prisma.taxa.findMany({
      orderBy: { type: "asc" },
    });
  }

  /**
   * Atualiza uma taxa existente ou cria se não houver (Upsert)
   */
  static async update(data: UpdateTaxaDTO) {
    try {
      return await prisma.taxa.upsert({
        where: { type: data.type },
        update: { value: data.value },
        create: {
          type: data.type,
          value: data.value,
        },
      });
    } catch (error) {
      throw new AppError("Erro ao atualizar a taxa do sistema", 500);
    }
  }

  /**
   * Busca uma taxa específica pelo tipo
   */
  static async getByType(type: ContractPeriodicity) {
    const taxa = await prisma.taxa.findUnique({
      where: { type },
    });

    if (!taxa) {
      throw new AppError("Taxa não configurada para este período", 404);
    }

    return taxa;
  }
}
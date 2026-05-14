import { prisma } from "../lib/prisma";


interface BalanceOperationDTO {
  userId: string;
  valor: number;
  descricao: string;
}

export class BalanceService {
  /**
   * 🟢 ADICIONAR SALDO (Aporte / Depósito)
   */
  static async addBalance(data: BalanceOperationDTO) {
    const { userId, valor, descricao } = data;
    const valorDecimal = Number(valor);

    if (valorDecimal <= 0) throw new Error("O valor deve ser positivo.");

    return await prisma.$transaction(async (tx) => {
      // 1. Busca saldo ATUAL
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { saldoOperacional: true },
      });

      const saldoAnterior = Number(user.saldoOperacional);
      const novoSaldo = saldoAnterior + valorDecimal;

      // 2. Atualiza o User
      await tx.user.update({
        where: { id: userId },
        data: { saldoOperacional: novoSaldo },
      });

      // 3. Salva no Log
      const log = await tx.balanceLog.create({
        data: {
          userId,
          tipo: "ENTRADA",
          valor: valorDecimal,
          descricao: descricao || "Aporte Manual",
          saldoAnterior: saldoAnterior,
          saldoNovo: novoSaldo,
        },
      });

      return {
        novoSaldo,
        operacao: log,
      };
    });
  }

  /**
   * 🔴 REMOVER SALDO (Sangria / Retirada)
   */
  static async removeBalance(data: BalanceOperationDTO) {
    const { userId, valor, descricao } = data;
    const valorDecimal = Number(valor);

    if (valorDecimal <= 0) throw new Error("O valor deve ser positivo.");

    return await prisma.$transaction(async (tx) => {
      // 1. Busca e Valida Saldo
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { saldoOperacional: true },
      });

      const saldoAnterior = Number(user.saldoOperacional);

      if (saldoAnterior < valorDecimal) {
        throw new Error(
          `Saldo insuficiente. Disponível: R$ ${saldoAnterior.toFixed(2)}`
        );
      }

      const novoSaldo = saldoAnterior - valorDecimal;

      // 2. Atualiza o User
      await tx.user.update({
        where: { id: userId },
        data: { saldoOperacional: novoSaldo },
      });

      // 3. Salva no Log
      const log = await tx.balanceLog.create({
        data: {
          userId,
          tipo: "SAIDA",
          valor: valorDecimal,
          descricao: descricao || "Retirada Manual",
          saldoAnterior: saldoAnterior,
          saldoNovo: novoSaldo,
        },
      });

      return {
        novoSaldo,
        operacao: log,
      };
    });
  }

  /**
   * 👁️ CONSULTAR SALDO (Renomeado de getSaldo para getBalance)
   */
  static async getBalance(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { saldoOperacional: true },
    });
    return Number(user?.saldoOperacional || 0);
  }
  
  /**
   * 📜 CONSULTAR EXTRATO
   */
  static async getHistory(userId: string) {
    return await prisma.balanceLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }
}
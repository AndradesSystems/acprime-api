import { prisma } from "../lib/prisma";
import { AppError } from "../middlewares/error.middleware";
import type { ContractPeriodicity } from "../generated/prisma/enums";

export class ContractService {
  /* =========================================================
        🛡️ APLICAÇÃO DE TAXAS
        - Lógica de "Calendar Day" via UTC.
        - Bulk Updates para performance.
     ========================================================= */
  static async applyPendingTaxes(userId: string) {
    try {
      const now = new Date();
      const hoje = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      const [taxasConfig, contratos] = await Promise.all([
        prisma.taxa.findMany(),
        prisma.contract.findMany({
          where: {
            userId: userId,
            status: { in: ["ABERTO", "ATRASADO"] },
          },
          include: {
            installments: {
              where: { status: "PENDENTE" },
            },
          },
        }),
      ]);

      if (contratos.length === 0) return;

      const updatesPromises: any[] = [];
      const configMap = new Map(taxasConfig.map((t) => [t.type, Number(t.value)]));

      for (const contrato of contratos) {
        let novaSomaTaxas = 0;
        const v = new Date(contrato.vencimentoEm);

        if (contrato.periodicity === "MONTHLY") {
          const valorConfig = configMap.get("MONTHLY") || 0;
          if (valorConfig > 0) {
            const vencimentoPuro = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
            if (vencimentoPuro < hoje) {
              const dias = Math.round((hoje.getTime() - vencimentoPuro.getTime()) / (1000 * 60 * 60 * 24));
              if (dias > 0) novaSomaTaxas = Number(((valorConfig / 30) * dias).toFixed(2));
            }
          }
        } else {
          const valorMultaDiaria = configMap.get(contrato.periodicity) || 0;

          for (const inst of contrato.installments) {
            let taxaParcelaCalculada = 0;
            const vi = new Date(inst.dataVencimento);
            const vencInstPuro = new Date(Date.UTC(vi.getUTCFullYear(), vi.getUTCMonth(), vi.getUTCDate()));

            if (vencInstPuro < hoje && valorMultaDiaria > 0) {
              const dias = Math.round((hoje.getTime() - vencInstPuro.getTime()) / (1000 * 60 * 60 * 24));
              if (dias > 0) {
                taxaParcelaCalculada = Number((dias * valorMultaDiaria).toFixed(2));
              }
            }

            if (Math.abs(taxaParcelaCalculada - Number(inst.taxa || 0)) > 0.01) {
              updatesPromises.push(
                prisma.contractInstallment.update({
                  where: { id: inst.id },
                  data: { taxa: taxaParcelaCalculada },
                })
              );
            }
            novaSomaTaxas += taxaParcelaCalculada;
          }
        }

        const novoStatus = novaSomaTaxas > 0 ? "ATRASADO" : "ABERTO";
        if (Math.abs(novaSomaTaxas - Number(contrato.taxa || 0)) > 0.01 || contrato.status !== novoStatus) {
          updatesPromises.push(
            prisma.contract.update({
              where: { id: contrato.id },
              data: { taxa: Number(novaSomaTaxas.toFixed(2)), status: novoStatus },
            })
          );
        }
      }

      if (updatesPromises.length > 0) {
        await Promise.all(updatesPromises);
      }
    } catch (e) {
      console.error("[TAX_ENGINE_ERROR]", e);
    }
  }

  /* =========================================================
        ✅ CRIAÇÃO (CREATE)
     ========================================================= */
  static async create(data: {
    clientId: string;
    userId: string;
    valorPrincipal: number;
    jurosPercent: number;
    vencimentoEm: string;
    periodicity: ContractPeriodicity;
    dataInicio?: string;
  }) {
    const dataRef = data.dataInicio ? new Date(data.dataInicio) : new Date();

    const baseDate = new Date(
      Date.UTC(dataRef.getUTCFullYear(), dataRef.getUTCMonth(), dataRef.getUTCDate(), 12, 0, 0)
    );

    let contractData: any = {
      clientId: data.clientId,
      userId: data.userId,
      valorPrincipal: data.valorPrincipal,
      jurosPercent: data.jurosPercent,
      periodicity: data.periodicity,
      status: "ABERTO",
      taxa: 0,
    };

    if (data.periodicity === "MONTHLY") {
      contractData.valorEmAberto = data.valorPrincipal;
      const nextMonth = new Date(baseDate);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      contractData.vencimentoEm = nextMonth;
    } else {
      const jurosValor = data.valorPrincipal * (data.jurosPercent / 100);
      const montanteTotal = data.valorPrincipal + jurosValor;
      contractData.valorEmAberto = montanteTotal;

      const numParcelas = data.periodicity === "DAILY" ? 20 : 4;
      const valorParcela = montanteTotal / numParcelas;
      const installmentsList = [];

      for (let i = 0; i < numParcelas; i++) {
        let vencimentoParcela = new Date(baseDate);
        const fator = i + 1;

        if (data.periodicity === "DAILY") {
          vencimentoParcela.setUTCDate(vencimentoParcela.getUTCDate() + fator);
        } else if (data.periodicity === "WEEKLY") {
          vencimentoParcela.setUTCDate(vencimentoParcela.getUTCDate() + fator * 7);
        }

        installmentsList.push({
          numeroParcela: i + 1,
          valor: valorParcela,
          taxa: 0,
          dataVencimento: vencimentoParcela,
          status: "PENDENTE",
        });
      }

      const primeiraParcela = installmentsList[0];
      if (!primeiraParcela) {
        throw new AppError("Erro ao gerar parcelas do contrato.", 500);
      }

      contractData.vencimentoEm = primeiraParcela.dataVencimento;
      contractData.installments = { create: installmentsList };
    }

    return prisma.$transaction(async (tx) => {
      const caixa = await tx.user.findUnique({
        where: { id: data.userId },
      });

      const saldoDisponivel = Number(caixa?.saldoOperacional || 0);

      if (saldoDisponivel < data.valorPrincipal) {
        throw new AppError("Saldo insuficiente em caixa.", 400);
      }

      await tx.user.update({
        where: { id: data.userId },
        data: {
          saldoOperacional: { decrement: data.valorPrincipal },
        },
      });

      return tx.contract.create({
        data: contractData,
      });
    });
  }

  /* =========================================================
        ✅ LISTAGEM (LIST)
     ========================================================= */
  static async list({
    userId,
    startDate,
    endDate,
  }: {
    userId: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    await this.applyPendingTaxes(userId);

    const where: any = {
      userId,
      status: { not: "QUITADO" },
    };

    if (startDate && endDate) {
      where.vencimentoEm = {
        gte: startDate,
        lte: endDate,
      };
    }

    return prisma.contract.findMany({
      where,
      orderBy: { vencimentoEm: "asc" },
      include: {
        client: { select: { nome: true } },
        installments: {
          where: { status: "PENDENTE" },
          take: 1,
          orderBy: { numeroParcela: "asc" },
        },
      },
    });
  }

  /* =========================================================
        🗑️ DELETE
     ========================================================= */
  static async delete(id: string, userId: string) {
    const contract = await prisma.contract.findFirst({
      where: { id, userId },
    });

    if (!contract) {
      throw new AppError("Contrato não encontrado", 403);
    }

    return await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          saldoOperacional: {
            increment: Number(contract.valorPrincipal || 0),
          },
        },
      });

      await tx.paymentHistory.deleteMany({ where: { contractId: id } });
      await tx.contractInstallment.deleteMany({ where: { contractId: id } });

      return await tx.contract.delete({
        where: { id },
      });
    });
  }

/* =========================================================
      🔍 LIST BY CLIENT ID (Novo método para o seu endpoint)
     ========================================================= */
  static async listByClientId(clientId: string, userId: string) {
    // Usamos findMany pois um cliente pode ter mais de um contrato
    const contracts = await prisma.contract.findMany({
      where: { 
        clientId, // Filtra pelo cliente correto
        userId    // Garante segurança: apenas contratos do usuário logado
      },
      include: {
        client: true,
        payments: { orderBy: { dataPagamento: "desc" } },
        installments: { orderBy: { numeroParcela: "asc" } },
      },
    });

    // Retorna a lista (se estiver vazia, retorna [], o que é o padrão REST para listagens)
    return contracts;
  }

  /* =========================================================
      🔍 GET BY ID (Seu método original corrigido)
     ========================================================= */
  static async getById(contractId: string, userId: string) {
    const c = await prisma.contract.findFirst({
      where: { 
        id: contractId, 
        userId 
      },
      include: {
        client: true,
        payments: { orderBy: { dataPagamento: "desc" } },
        installments: { orderBy: { numeroParcela: "asc" } },
      },
    });

    if (!c) throw new AppError("Contrato não encontrado", 404);
    return c;
  }

  /* =========================================================
        📅 UPDATE DUE DATE
     ========================================================= */
  static async updateDueDate(contractId: string, newDueDate: Date, userId: string) {
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, userId },
      include: { installments: true },
    });
    if (!contract) throw new AppError("Contrato não encontrado", 404);

    const vencimentoNormalizado = new Date(
      Date.UTC(newDueDate.getUTCFullYear(), newDueDate.getUTCMonth(), newDueDate.getUTCDate())
    );

    if (contract.periodicity === "MONTHLY") {
      return prisma.contract.update({
        where: { id: contractId },
        data: { vencimentoEm: vencimentoNormalizado, status: "ABERTO" },
      });
    }

    const nextInstallment = contract.installments.find((i) => i.status === "PENDENTE");

    if (!nextInstallment) {
      throw new AppError("Sem parcelas pendentes", 400);
    }

    return prisma.$transaction(async (tx) => {
      await tx.contractInstallment.update({
        where: { id: nextInstallment.id },
        data: { dataVencimento: vencimentoNormalizado, taxa: 0 },
      });

      return tx.contract.update({
        where: { id: contractId },
        data: { vencimentoEm: vencimentoNormalizado, status: "ABERTO" },
      });
    });
  }

  /* =========================================================
        ℹ️ SUMMARY
     ========================================================= */
  static async summary(contractId: string, userId: string, now: Date) {
    const c = await this.getById(contractId, userId);
    const hoje = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    let saldoDevedorTotal = Number(c.valorEmAberto);
    let taxaPendente = Number(c.taxa);
    let jurosRealDoSaldo = 0;
    let capitalRealDoSaldo = 0;
    let diasAtraso = 0;

    if (c.periodicity === "MONTHLY") {
      jurosRealDoSaldo = Number(c.valorPrincipal) * (Number(c.jurosPercent) / 100);
      capitalRealDoSaldo = saldoDevedorTotal;

      const vUTC = new Date(c.vencimentoEm);
      const vencimentoUTC = new Date(Date.UTC(vUTC.getUTCFullYear(), vUTC.getUTCMonth(), vUTC.getUTCDate()));

      const diffTime = hoje.getTime() - vencimentoUTC.getTime();
      diasAtraso = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    } else {
      const percent = Number(c.jurosPercent || 0);
      if (percent > 0) {
        const fator = percent / (100 + percent);
        jurosRealDoSaldo = saldoDevedorTotal * fator;
        capitalRealDoSaldo = saldoDevedorTotal - jurosRealDoSaldo;
      } else {
        capitalRealDoSaldo = saldoDevedorTotal;
      }
    }

    const totalMes = saldoDevedorTotal + (c.periodicity === "MONTHLY" ? jurosRealDoSaldo : 0) + taxaPendente;

    return {
      contractId: c.id,
      status: c.status,
      principalEmAberto: saldoDevedorTotal,
      jurosDoMes: jurosRealDoSaldo,
      capitalReal: capitalRealDoSaldo,
      taxaPendente,
      diasAtraso,
      totalMes,
      vencimentoEm: c.vencimentoEm,
      installments: c.installments,
    };
  }
}
import { prisma } from "../lib/prisma";
import {
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
} from "date-fns";

export class DashboardService {
  static async getSummary(
    userId: string,
    startDate?: string,
    endDate?: string,
  ) {
    // 1. AJUSTE DE DATAS
    const inicio = startDate
      ? startOfDay(new Date(startDate))
      : startOfMonth(new Date());

    const fim = endDate
      ? endOfDay(new Date(endDate))
      : endOfDay(endOfMonth(new Date()));

    // Helper para garantir aproximação e arredondamento financeiro de 2 casas decimais
    const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

    // =========================================================================
    // 1. TOTAL EMPRESTADO (SNAPSHOT GERAL)
    // =========================================================================
    const activeContracts = await prisma.contract.findMany({
      where: {
        userId,
        status: { not: "QUITADO" }
      },
      select: { valorPrincipal: true, periodicity: true },
    });

    const subTotalEmprestado = { diario: 0, semanal: 0, mensal: 0 };
    activeContracts.forEach((c) => {
      const v = Number(c.valorPrincipal);
      if (c.periodicity === "DAILY") subTotalEmprestado.diario += v;
      else if (c.periodicity === "WEEKLY") subTotalEmprestado.semanal += v;
      else if (c.periodicity === "MONTHLY") subTotalEmprestado.mensal += v;
    });

    // Arredondando os subvalores para o payload do front
    subTotalEmprestado.diario = round2(subTotalEmprestado.diario);
    subTotalEmprestado.semanal = round2(subTotalEmprestado.semanal);
    subTotalEmprestado.mensal = round2(subTotalEmprestado.mensal);

    // =========================================================================
    // 2. TOTAL RECEBIDO (REALIZADO - CAIXA)
    // =========================================================================
    const payments = await prisma.paymentHistory.findMany({
      where: {
        contract: { userId },
        dataPagamento: { gte: inicio, lte: fim },
      },
      include: { contract: { select: { periodicity: true } } },
    });

    const subTotalRecebido = { viaParcelas: 0, viaMensal: 0, viaTaxas: 0 };

    payments.forEach((p) => {
      const valorTotalRegistro = Number(p.valorPago);
      const taxa = Number(p.pagoTaxa || 0);
      const valorLimpo = valorTotalRegistro - taxa;

      subTotalRecebido.viaTaxas += taxa;

      if (p.contract?.periodicity === "MONTHLY") {
        subTotalRecebido.viaMensal += valorLimpo;
      } else {
        subTotalRecebido.viaParcelas += valorLimpo;
      }
    });

    subTotalRecebido.viaParcelas = round2(subTotalRecebido.viaParcelas);
    subTotalRecebido.viaMensal = round2(subTotalRecebido.viaMensal);
    subTotalRecebido.viaTaxas = round2(subTotalRecebido.viaTaxas);

    // =========================================================================
    // 3. A RECEBER (PREVISÃO DE JUROS E MONTANTES)
    // =========================================================================

    // A. PARCELAS (Diário/Semanal)
    const installmentsDueList = await prisma.contractInstallment.findMany({
      where: {
        contract: {
          userId,
          status: { not: "QUITADO" }
        },
        dataVencimento: { gte: inicio, lte: fim },
        status: "PENDENTE",
      },
      include: {
        contract: { select: { jurosPercent: true, periodicity: true } },
      },
    });

    let valorTotalParcelas = 0;
    let jurosExtraidosParcelas = 0;

    installmentsDueList.forEach((inst) => {
      const valor = Number(inst.valor);
      valorTotalParcelas += valor;

      if (inst.contract?.periodicity !== "MONTHLY") {
        const percent = Number(inst.contract?.jurosPercent || 0);
        if (percent > 0) {
          const fator = percent / (100 + percent);
          jurosExtraidosParcelas += valor * fator;
        }
      }
    });

    // B. MENSAL
    const monthlyDue = await prisma.contract.findMany({
      where: {
        userId,
        periodicity: "MONTHLY",
        status: { not: "QUITADO" },
        vencimentoEm: { gte: inicio, lte: fim },
      },
      select: { valorPrincipal: true, jurosPercent: true, taxa: true },
    });

    let jurosMensalPrevisto = 0;
    let taxasMensalPrevistas = 0;
    let principalMensalPendente = 0;

    monthlyDue.forEach((c) => {
      const p = Number(c.valorPrincipal);
      jurosMensalPrevisto += p * (Number(c.jurosPercent) / 100);
      taxasMensalPrevistas += Number(c.taxa);
      principalMensalPendente += p;
    });

    // Consolidação de Cálculos Macros com Proteção Numérica
    const totalJurosGeralAReceber = round2(jurosExtraidosParcelas + jurosMensalPrevisto + taxasMensalPrevistas);
    const totalMontanteAReceber = round2(valorTotalParcelas + (principalMensalPendente + jurosMensalPrevisto + taxasMensalPrevistas));

    // =========================================================================
    // 4. CONTRATOS RECENTES
    // =========================================================================
    const recentContractsData = await prisma.contract.findMany({
      where: { userId, status: { not: "QUITADO" } },
      orderBy: { vencimentoEm: "asc" },
      take: 5,
      select: {
        id: true,
        valorPrincipal: true,
        jurosPercent: true,
        vencimentoEm: true,
        status: true,
        periodicity: true,
        client: { select: { nome: true } },
        _count: { select: { installments: true } },
        installments: { where: { status: "PAGO" }, select: { id: true } },
      },
    });

    const recentContracts = recentContractsData.map((c) => {
      const principal = Number(c.valorPrincipal);
      const percentual = Number(c.jurosPercent || 0);
      const lucroCalculado = round2(principal * (percentual / 100));

      return {
        id: c.id,
        clientName: c.client.nome,
        valorPrincipal: principal,
        jurosCalculados: lucroCalculado,
        vencimentoEm: c.vencimentoEm,
        status: c.status,
        periodicity: c.periodicity,
        totalInstallments: c._count.installments,
        paidInstallments: c.installments.length,
      };
    });

    return {
      totalEmprestado: round2(
        subTotalEmprestado.diario +
        subTotalEmprestado.semanal +
        subTotalEmprestado.mensal
      ),
      subTotalEmprestado,

      jurosETaxasAReceber: totalJurosGeralAReceber,
      // 🎯 MODIFICADO: Agora estruturado exatamente com os nomes que seu card do front-end lê
      subJurosAReceber: {
        jurosMensais: round2(jurosMensalPrevisto),
        jurosParcelados: round2(jurosExtraidosParcelas),
        taxas: round2(taxasMensalPrevistas),
      },

      totalMontanteAReceber,
      subMontanteAReceber: {
        parcelas: round2(valorTotalParcelas),
        mensal: round2(principalMensalPendente + jurosMensalPrevisto + taxasMensalPrevistas),
      },

      totalRecebido: round2(
        subTotalRecebido.viaParcelas +
        subTotalRecebido.viaMensal +
        subTotalRecebido.viaTaxas
      ),
      subTotalRecebido,

      recentContracts,
    };
  }
}
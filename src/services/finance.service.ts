import type { ExpenseType, TransactionFlow, TransactionStatus } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";

import { AppError } from "../middlewares/error.middleware";
import { endOfDay, startOfDay } from "date-fns";

export type FinanceExpenseInput = {
  descricao: string;
  tipo: ExpenseType;
  tipo_fluxo: TransactionFlow;
  categoria?: string | null;
  valor: number;
  pago?: boolean;
  status?: TransactionStatus;
  dataInicio?: Date | string;
  parcelasTotal?: number | null;
  parcelaAtual?: number | null;
  diaDoMes?: number | null;
  userId: string;
};

export class FinanceService {
  /* =======================
         CREATE EXPENSE
   ======================= */
  static async createExpense(data: FinanceExpenseInput) {
    if (!data.descricao?.trim())
      throw new AppError("Descrição é obrigatória", 400);
    if (!data.valor || data.valor <= 0)
      throw new AppError("Valor inválido", 400);

    const dataBase = data.dataInicio ? new Date(data.dataInicio) : new Date();
    const transacoesParaCriar = [];

    const totalRegistros =
      data.tipo === "PARCELADO"
        ? data.parcelasTotal || 1
        : data.tipo === "FIXO"
          ? 12
          : 1;

    for (let i = 0; i < totalRegistros; i++) {
      const dataParcela = new Date(dataBase);
      dataParcela.setMonth(dataBase.getMonth() + i);

      const novaTransacao = {
        descricao:
          data.tipo === "PARCELADO"
            ? `${data.descricao.trim()} (${i + 1}/${totalRegistros})`
            : data.descricao.trim(),
        tipo: data.tipo,
        tipo_fluxo: data.tipo_fluxo,
        categoria: data.categoria ?? null,
        valor: data.valor,
        status: i === 0 ? data.status || "PENDENTE" : "PENDENTE",
        pago: i === 0 ? data.pago || false : false,
        dataInicio: dataParcela,
        parcelasTotal: data.tipo === "PARCELADO" ? totalRegistros : null,
        parcelaAtual: data.tipo === "PARCELADO" ? i + 1 : null,
        userId: data.userId,
      };

      transacoesParaCriar.push(novaTransacao);
    }

    await prisma.personalExpense.createMany({ data: transacoesParaCriar });

    return transacoesParaCriar[0];
  }

  /* =======================
       GET BY ID
  ======================= */
  static async getExpenseById(id: string, userId: string) {
    const item = await prisma.personalExpense.findFirst({
      where: { id, userId }, // 🔒 Trava de segurança
    });
    if (!item)
      throw new AppError("Registro não encontrado ou acesso negado", 404);
    return item;
  }

  /* =======================
          UPDATE EXPENSE
    ======================= */
  static async updateExpense(id: string, userId: string, data: any) {
    await this.getExpenseById(id, userId);

    const updateData: any = {};

    if (data.descricao !== undefined) updateData.descricao = data.descricao?.trim();
    if (data.tipo !== undefined) updateData.tipo = data.tipo;
    if (data.tipo_fluxo !== undefined) updateData.tipo_fluxo = data.tipo_fluxo;
    if (data.categoria !== undefined) updateData.categoria = data.categoria ?? null;
    if (data.valor !== undefined) updateData.valor = data.valor;
    if (data.pago !== undefined) updateData.pago = data.pago;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.parcelaAtual !== undefined) updateData.parcelaAtual = data.parcelaAtual;
    if (data.parcelasTotal !== undefined) updateData.parcelasTotal = data.parcelasTotal;

    if (data.dataInicio) {
      updateData.dataInicio = new Date(data.dataInicio);
    }

    return prisma.personalExpense.update({
      where: { id },
      data: updateData,
    });
  }

  /* =======================
       UPDATE STATUS (Baixa Rápida)
  ======================= */
  static async updateStatus(
    id: string,
    userId: string,
    status: TransactionStatus,
  ) {
    await this.getExpenseById(id, userId);

    return prisma.personalExpense.update({
      where: { id },
      data: {
        status,
        pago: status === "CONCLUIDO",
      },
    });
  }

  /* =======================
       LIST EXPENSES
  ======================= */
  static async listExpenses(params: any) {
    const where: any = { userId: params.userId }; // 🔒 Filtro obrigatório

    if (params.startDate && params.endDate) {
      where.dataInicio = {
        gte: new Date(params.startDate),
        lte: new Date(params.endDate),
      };
    }

    if (params.tipo) where.tipo = params.tipo;
    if (params.tipo_fluxo) where.tipo_fluxo = params.tipo_fluxo;
    if (params.status) where.status = params.status;

    if (params.search) {
      where.OR = [
        { descricao: { contains: params.search, mode: "insensitive" } },
        { categoria: { contains: params.search, mode: "insensitive" } },
      ];
    }

    return prisma.personalExpense.findMany({
      where,
      orderBy: { dataInicio: "asc" },
    });
  }

  /* =======================
         REMOVE EXPENSE
   ======================= */
  static async removeExpense(
    id: string,
    userId: string,
    mode: "single" | "future" | "all" = "single",
  ) {
    const expense = await this.getExpenseById(id, userId);

    if (!expense) {
      throw new AppError("Despesa não encontrada", 404);
    }

    if (expense.tipo === "VARIAVEL" || mode === "single") {
      return prisma.personalExpense.delete({
        where: { id, userId },
      });
    }

    const descricaoBase = expense.descricao?.split(" (")[0]?.trim() || expense.descricao;

    const whereClause: any = {
      userId,
      descricao: { startsWith: descricaoBase },
      tipo: expense.tipo,
    };

    if (mode === "future") {
      whereClause.dataInicio = { gte: expense.dataInicio };
    }

    return prisma.personalExpense.deleteMany({ where: whereClause });
  }


  /* =========================================================
      📊 SUMMARY FINANCEIRO HÍBRIDO (AJUSTADO: JUROS + TAXAS ÚNICAS)
     ========================================================= */
  static async expensesSummary(
    userId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const start = startDate ? startOfDay(new Date(startDate)) : undefined;
    const end = endDate ? endOfDay(new Date(endDate)) : undefined;

    const dateRangeFilter: any = {};
    if (start) dateRangeFilter.gte = start;
    if (end) dateRangeFilter.lte = end;

    const hasFilter = Object.keys(dateRangeFilter).length > 0;

    // 1. Agregados para Saldo Cumulativo (Histórico até a data final)
    const [
      historicoGastos,
      historicoLucroFinanceiro,
      historicoEntradasManuais,
    ] = await Promise.all([
      prisma.personalExpense.aggregate({
        where: {
          userId,
          tipo_fluxo: "SAIDA",
          ...(end && { dataInicio: { lte: end } }),
          status: { not: "CANCELADO" },
        },
        _sum: { valor: true },
      }),
      prisma.paymentHistory.aggregate({
        where: {
          contract: { userId },
          ...(end && { dataPagamento: { lte: end } })
        },
        _sum: { pagoJuros: true, pagoTaxa: true },
      }),
      prisma.personalExpense.aggregate({
        where: {
          userId,
          tipo_fluxo: "ENTRADA",
          ...(end && { dataInicio: { lte: end } }),
          status: { not: "CANCELADO" },
        },
        _sum: { valor: true },
      }),
    ]);

    const sumLucro = historicoLucroFinanceiro._sum || {};
    const sumEntradas = historicoEntradasManuais._sum || {};
    const sumGastos = historicoGastos._sum || {};

    // Saldo Acumulado considera Juros + Taxas + Multas como Receita de Lucro
    const saldoCumulativoGeral =
      Number(sumLucro.pagoJuros || 0) +
      Number(sumLucro.pagoTaxa || 0) +
      Number(sumEntradas.valor || 0) -
      Number(sumGastos.valor || 0);

    // 2. Entradas e Saídas Manuais do Período Filtro
    const manuaisList = await prisma.personalExpense.findMany({
      where: {
        userId,
        status: { not: "CANCELADO" },
        ...(hasFilter && { dataInicio: dateRangeFilter }),
      },
    });

    let entradasManuaisMes = 0;
    let totalGastosMes = 0;

    manuaisList.forEach((m) => {
      const val = Number(m.valor);
      if (m.tipo_fluxo === "ENTRADA") entradasManuaisMes += val;
      else totalGastosMes += val;
    });

    // 3. Capital (Principal) Recebido no Período
    const listCapitalCaixa = await prisma.paymentHistory.findMany({
      where: {
        contract: { userId },
        pagoPrincipal: { gt: 0 },
        ...(hasFilter && { dataPagamento: dateRangeFilter }),
      },
      select: { pagoPrincipal: true },
    });

    let realizadoPrincipalMes = 0;
    listCapitalCaixa.forEach((p) => {
      realizadoPrincipalMes += Number(p.pagoPrincipal || 0);
    });

    // 4. Lucro (Juros + Taxas) no Período
    const listJurosCompetencia = await prisma.paymentHistory.findMany({
      where: {
        contract: { userId },
        OR: [
          { ...(hasFilter && { dataReferencia: dateRangeFilter }) },
          {
            dataReferencia: null,
            ...(hasFilter && { dataPagamento: dateRangeFilter }),
          },
        ],
      },
      select: {
        pagoJuros: true,
        pagoTaxa: true,
        multaCobrada: true,
      },
    });

    let realizadoJurosPuro = 0;
    let realizadoTaxasEMultas = 0;

    listJurosCompetencia.forEach((p) => {
      realizadoJurosPuro += Number(p.pagoJuros || 0);
   
      realizadoTaxasEMultas += Number(p.pagoTaxa || 0)
    });

    const lucroTotalPeriodo = realizadoJurosPuro + realizadoTaxasEMultas;

    // Entrada Total = Capital + Juros + Taxas + Entradas Manuais
    const totalEntradasRelatorio =
      entradasManuaisMes + realizadoPrincipalMes + lucroTotalPeriodo;

    // 5. Previsão de Recebimento (Pendentes)
    const [pendingInst, pendingMonth] = await Promise.all([
      prisma.contractInstallment.findMany({
        where: {
          ...(hasFilter && { dataVencimento: dateRangeFilter }),
          status: { not: "PAGO" },
          contract: {
            userId,
            status: { not: "QUITADO" },
            periodicity: { not: "MONTHLY" },
          },
        },
        select: { valor: true, contract: { select: { jurosPercent: true } } },
      }),
      prisma.contract.findMany({
        where: {
          userId,
          periodicity: "MONTHLY",
          ...(hasFilter && { vencimentoEm: dateRangeFilter }),
          status: { not: "QUITADO" },
        },
        select: { valorPrincipal: true, jurosPercent: true, taxa: true },
      }),
    ]);

    let previstoJuros = 0;
    let previstoPrincipal = 0;
    let previstoBruto = 0;

    pendingInst.forEach((inst) => {
      const v = Number(inst.valor);
      const j = Number(inst.contract?.jurosPercent || 0);
      previstoBruto += v;
      if (j > 0) {
        const f = j / (100 + j);
        const jv = v * f;
        previstoJuros += jv;
        previstoPrincipal += v - jv;
      } else {
        previstoPrincipal += v;
      }
    });

    pendingMonth.forEach((cont) => {
      const lucro =
        Number(cont.valorPrincipal) * (Number(cont.jurosPercent) / 100) +
        Number(cont.taxa || 0);
      previstoBruto += lucro;
      previstoJuros += lucro;
      // Em contratos mensais, o principal geralmente não é "pago" na parcela de juros
    });

    return {
      totalEntradas: totalEntradasRelatorio,         // Resultado esperado: 1410
      totalPrincipalRecebido: realizadoPrincipalMes,  // Resultado esperado: 1000
      totalJurosRecebido: lucroTotalPeriodo,          // Resultado esperado: 410
      totalGastos: totalGastosMes,
      saldo: lucroTotalPeriodo - totalGastosMes,      // Lucro Líquido do período
      saldoCumulativo: saldoCumulativoGeral,
      previsao: {
        totalEntradas: previstoBruto,
        totalPrincipal: previstoPrincipal,
        totalJuros: previstoJuros,
      },
      subDetalhes: {
        entradasManuais: entradasManuaisMes,
        recebidoContratosBruto: totalEntradasRelatorio - entradasManuaisMes,
        acumuladoHistorico: {
          jurosTotais: Number(sumLucro.pagoJuros || 0),
          taxasTotais: Number(sumLucro.pagoTaxa || 0),
          gastosTotais: Number(sumGastos.valor || 0),
        },
      },
    };
  }
}

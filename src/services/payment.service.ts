import { endOfDay, startOfDay, addDays } from "date-fns";
import { prisma } from "../lib/prisma";
import { AppError } from "../middlewares/error.middleware";
import { ContractService } from "./contract.service";
import type { Prisma } from "../generated/prisma/client";

type PaymentType = "JUROS" | "PRINCIPAL" | "MISTO";

interface CreatePaymentInput {
  tipo: PaymentType;
  valorPago: number;
  observacao?: string;
  valorDestinadoTaxa?: number;
}

export class PaymentService {
  /* ===============================
        LISTAGEM E HISTÓRICO
  =============================== */
  static async listByContract(contractId: string, userId: string) {
    return prisma.paymentHistory.findMany({
      where: {
        contractId,
        contract: { userId }, // 🔒 Trava de usuário
      },
      orderBy: { dataPagamento: "desc" },
    });
  }

  /* =========================================================
           🗑️ EXCLUSÃO DE PAGAMENTO (ESTORNO) - VERSÃO COMPLETA
           - Valida Contrato Mensal (Juros/Quitação/Taxas e Rollover de Vencimento)
           - Valida Contrato Parcelado (Restauração de Vencimentos)
           - Reverte Saldo Operacional do Caixa do Usuário
           - Tipagem TypeScript 100% Protegida
       ========================================================= */
  static async delete(paymentId: string, userId: string) {
    // 1. Busca o pagamento no histórico garantindo o vínculo com o usuário dono do contrato
    const payment = await prisma.paymentHistory.findFirst({
      where: { id: paymentId, contract: { userId } },
      include: { contract: true },
    });

    if (!payment) {
      throw new AppError(
        "Pagamento não encontrado ou sem permissão para excluir.",
        404,
      );
    }

    const { contractId, pagoPrincipal, pagoJuros, pagoTaxa, contract } = payment;

    // 2. Inicia a transação para garantir consistência total nos estornos
    return prisma.$transaction(
      async (tx) => {
        const principalEstorno = Number(pagoPrincipal || 0);
        const jurosEstorno = Number(pagoJuros || 0);
        const taxaEstorno = Number(pagoTaxa || 0);

        /* ---------------------------------------------------------
           CENÁRIO A: CONTRATO MENSAL (MONTHLY)
        --------------------------------------------------------- */
        if (contract.periodicity === "MONTHLY") {
          // O total que deve voltar a ficar Em Aberto é a soma do que foi abatido
          const totalEstornado = principalEstorno + jurosEstorno + taxaEstorno;

          // 🌟 MÁGICA DA DATA: Como você salva o vencimento original no dataReferencia 
          // durante a criação, nós o usamos para desfazer qualquer rollover perfeitamente!
          const dataVencimentoOriginal = payment.dataReferencia
            ? new Date(payment.dataReferencia)
            : contract.vencimentoEm;

          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorPrincipal: { increment: principalEstorno },
              valorEmAberto: { increment: totalEstornado },
              taxa: { increment: taxaEstorno },
              vencimentoEm: dataVencimentoOriginal, // Volta o relógio do mês!
              status: "ABERTO",
            },
          });
        } else {
          /* ---------------------------------------------------------
             CENÁRIO B: CONTRATO PARCELADO (DAILY / WEEKLY)
          --------------------------------------------------------- */
          const installmentsPaid = await tx.contractInstallment.findMany({
            where: { contractId, status: "PAGO" },
            orderBy: { numeroParcela: "desc" },
          });

          // No parcelado, o valor descontado do "valorParcelaRestante" no seu create 
          // é a soma do principal + juros. É isso que precisamos devolver à parcela.
          let valorRestanteParaEstornar = principalEstorno + jurosEstorno;
          let taxaRestanteParaEstornar = taxaEstorno;

          for (const inst of installmentsPaid) {
            if (valorRestanteParaEstornar <= 0 && taxaRestanteParaEstornar <= 0) break;

            // Como as parcelas pagas foram levadas a valor <= 0 no create, 
            // no estorno nós devolvemos a injeção financeira para elas
            await tx.contractInstallment.update({
              where: { id: inst.id },
              data: {
                status: "PENDENTE",
                dataPagamento: null,
                valor: { increment: valorRestanteParaEstornar },
                taxa: { increment: taxaRestanteParaEstornar }
              },
            });

            // Consideramos aplicado na última parcela paga e encerramos o loop
            valorRestanteParaEstornar = 0;
            taxaRestanteParaEstornar = 0;
          }

          // Busca as pendentes recém reabertas para recalcular a data de vencimento raiz do contrato
          const pendingInstallments = await tx.contractInstallment.findMany({
            where: { contractId, status: "PENDENTE" },
            orderBy: { dataVencimento: "asc" },
          });

          // Safe check contra 'undefined' para o TypeScript aprovar o build 🔒
          const primeiraParcelaPendente = pendingInstallments[0];
          const novoVencimentoContrato = primeiraParcelaPendente?.dataVencimento
            ? new Date(primeiraParcelaPendente.dataVencimento)
            : contract.vencimentoEm;

          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorEmAberto: { increment: principalEstorno + jurosEstorno },
              taxa: { increment: taxaEstorno },
              vencimentoEm: novoVencimentoContrato, // Restaura o alerta de atraso se necessário
              status: "ABERTO",
            },
          });
        }

        /* ---------------------------------------------------------
           💰 ESTORNO DO CAIXA DO USUÁRIO (Devolução de Saldo Operacional)
           No create(), o "pagoPrincipalAcumulado" aumenta o saldo da conta.
           Aqui no estorno, precisamos retirar esse valor falso do caixa.
        --------------------------------------------------------- */
        if (principalEstorno > 0) {
          await tx.user.update({
            where: { id: userId },
            data: {
              saldoOperacional: { decrement: principalEstorno },
            },
          });
        }

        /* ---------------------------------------------------------
           DELEÇÃO DO HISTÓRICO
        --------------------------------------------------------- */
        await tx.paymentHistory.delete({
          where: { id: paymentId },
        });

      },
      { timeout: 15000 },
    );
  }

  static async historyByContract(contractId: string, userId: string) {
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, userId }, // 🔒 Trava de usuário
      select: { id: true },
    });

    if (!contract) throw new AppError("Contrato não encontrado", 404);

    return prisma.paymentHistory.findMany({
      where: { contractId },
      orderBy: { createdAt: "desc" },
      include: {
        createdByUser: {
          select: { id: true, nome: true, email: true },
        },
      },
    });
  }

  /* ===============================
       🔥 QUITAÇÃO COMPLETA (Payoff)
 =============================== */
  static async payFullContract(contractId: string, userId: string) {
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, userId },
      include: { installments: { where: { status: "PENDENTE" } } },
    });

    if (!contract || contract.status === "QUITADO") {
      throw new AppError("Contrato inexistente ou já quitado.", 400);
    }

    const valorPrincipalAberto = Number(contract.valorEmAberto);
    const taxaTotalAcumulada = Number(contract.taxa);
    const totalPagar = valorPrincipalAberto + taxaTotalAcumulada;

    // Define a referência: Se for mensal, usa o vencimento original.
    // Se for parcelado, usa hoje (pois é uma liquidação antecipada).
    const dataReferenciaAuditoria =
      contract.periodicity === "MONTHLY" ? contract.vencimentoEm : new Date();

    return await prisma.$transaction(
      async (tx) => {
        // 1. Quita todas as parcelas e zera as taxas de cada uma
        await tx.contractInstallment.updateMany({
          where: { contractId, status: "PENDENTE" },
          data: {
            status: "PAGO",
            taxa: 0,
            dataPagamento: new Date(),
          },
        });

        // 2. Registra histórico com a DATA DE REFERÊNCIA
        await tx.paymentHistory.create({
          data: {
            contractId,
            createdByUserId: userId,
            tipo: "MISTO",
            valorPago: totalPagar,
            pagoPrincipal: valorPrincipalAberto,
            pagoTaxa: taxaTotalAcumulada,
            pagoJuros: 0,
            multaCobrada: taxaTotalAcumulada,
            observacao: "Quitação total do contrato (Payoff)",
            dataReferencia: dataReferenciaAuditoria, // 👈 NOVO CAMPO
          },
        });

        // 3. Finaliza contrato pai
        return await tx.contract.update({
          where: { id: contractId },
          data: { valorEmAberto: 0, taxa: 0, status: "QUITADO" },
        });
      },
      { timeout: 15000 },
    );
  }

  /* ===============================
       PAGAMENTO DE PARCELA ÚNICA
 =============================== */
  static async payInstallment(installmentId: string, userId: string) {
    const inst = await prisma.contractInstallment.findFirst({
      where: {
        id: installmentId,
        contract: { userId },
      },
      include: { contract: true },
    });

    if (!inst || inst.status === "PAGO")
      throw new AppError("Parcela inválida.", 400);

    const valorParcela = Number(inst.valor);
    const taxaParcela = Number(inst.taxa);
    const totalPago = valorParcela + taxaParcela;

    return await prisma.$transaction(async (tx) => {
      await tx.contractInstallment.update({
        where: { id: installmentId },
        data: { status: "PAGO", taxa: 0, dataPagamento: new Date() },
      });

      await tx.paymentHistory.create({
        data: {
          contractId: inst.contractId,
          createdByUserId: userId,
          tipo: "MISTO",
          valorPago: totalPago,
          pagoPrincipal: valorParcela,
          pagoTaxa: taxaParcela,
          pagoJuros: 0,
          multaCobrada: taxaParcela,
          dataReferencia: inst.dataVencimento, // 👈 AQUI ESTÁ A MÁGICA
        },
      });

      // ... (restante da lógica de atualização do contrato pai mantém igual)
      const parcelasRestantes = await tx.contractInstallment.findMany({
        where: { contractId: inst.contractId, status: "PENDENTE" },
      });

      const novoValorEmAberto = parcelasRestantes.reduce(
        (acc, p) => acc + Number(p.valor),
        0,
      );
      const novaSomaTaxas = parcelasRestantes.reduce(
        (acc, p) => acc + Number(p.taxa),
        0,
      );

      return await tx.contract.update({
        where: { id: inst.contractId },
        data: {
          valorEmAberto: novoValorEmAberto,
          taxa: novaSomaTaxas,
          status:
            novoValorEmAberto <= 0 && novaSomaTaxas <= 0
              ? "QUITADO"
              : inst.contract.status,
        },
      });
    });
  }

  /* =========================================================
          💰 CRIAÇÃO DE PAGAMENTO COM CÁLCULO DE JUROS (ACID)
       ========================================================= */
  static async create(
    contractId: string,
    data: CreatePaymentInput,
    userId: string,
  ): Promise<void> {

    // 1. Validação Inicial de Existência e Permissão
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, userId },
    });

    if (!contract) {
      throw new AppError("Contrato não encontrado", 404);
    }

    // 2. Busca o estado atual trazendo as parcelas pendentes ordenadas
    const contractAtualizado = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        installments: {
          where: { status: "PENDENTE" },
          orderBy: { numeroParcela: "asc" },
        },
      },
    });

    if (!contractAtualizado) {
      throw new AppError("Erro ao processar contrato", 500);
    }

    // 3. Inicia a Transação ACID no Banco de Dados
    return prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        let saldoParaAbater: number = Number(data.valorPago);
        let pagoTaxaAcumulado: number = 0;
        let pagoPrincipalAcumulado: number = 0;
        let pagoJurosAcumulado: number = 0;

        // 🎯 Definição da Data de Referência (Competência)
        let dataReferenciaAuditoria: Date;

        if (contractAtualizado.periodicity === "MONTHLY") {
          dataReferenciaAuditoria = new Date(contractAtualizado.vencimentoEm);
        } else {
          dataReferenciaAuditoria =
            contractAtualizado.installments[0]?.dataVencimento
              ? new Date(contractAtualizado.installments[0].dataVencimento)
              : new Date();
        }

        let limiteTaxaRestante: number =
          data.valorDestinadoTaxa !== undefined
            ? Number(data.valorDestinadoTaxa)
            : saldoParaAbater;

        /* ---------------------------------------------------------
           CENÁRIO A: CONTRATO MENSAL (MONTHLY) - CONSERTADO 🛠️
        --------------------------------------------------------- */
        if (contractAtualizado.periodicity === "MONTHLY") {
          let taxaAtual: number = Number(contractAtualizado.taxa || 0);
          let principalAtual: number = Number(contractAtualizado.valorPrincipal || 0);
          let totalGeralDevido: number = Number(contractAtualizado.valorEmAberto || 0);

          // 💡 Juros real é a diferença exata entre o total em aberto e o capital principal seco
          let jurosAtual: number = Math.max(0, totalGeralDevido - principalAtual);

          const totalMaxDevido: number = taxaAtual + totalGeralDevido;

          // 🛑 TRAVA DE SEGURANÇA: Bloqueia valores acima do saldo devedor real daquele mês
          if (saldoParaAbater > totalMaxDevido) {
            throw new AppError(
              `O valor enviado (R$ ${saldoParaAbater}) excede o total devedor do contrato (R$ ${totalMaxDevido}).`,
              400
            );
          }

          // [Passo 1] Abate Taxa Mensal (se houver)
          if (taxaAtual > 0 && limiteTaxaRestante > 0) {
            const abatimento: number = Math.min(
              saldoParaAbater,
              taxaAtual,
              limiteTaxaRestante,
            );
            pagoTaxaAcumulado = abatimento;
            saldoParaAbater -= abatimento;
            taxaAtual -= abatimento;
          }

          // [Passo 2] Abate os Juros Mensais existentes na diferença (os R$ 400 do exemplo)
          if (saldoParaAbater > 0 && jurosAtual > 0) {
            const abatimentoJuros: number = Math.min(saldoParaAbater, jurosAtual);
            pagoJurosAcumulado = abatimentoJuros;
            saldoParaAbater -= abatimentoJuros;
            jurosAtual -= abatimentoJuros;
          }

          // [Passo 3] Abate o Principal Seco (os R$ 1000 do exemplo)
          if (saldoParaAbater > 0 && principalAtual > 0) {
            const abatimentoPrincipal: number = Math.min(saldoParaAbater, principalAtual);
            pagoPrincipalAcumulado = abatimentoPrincipal;
            saldoParaAbater -= abatimentoPrincipal;
            principalAtual -= abatimentoPrincipal;
          }

          // Recalcula o novo total em aberto somando o que restou de principal e juros residual
          let novoValorEmAberto: number = principalAtual + jurosAtual;

          // [Passo 4] Lógica de Renovação de Data (Rollover)
          let novaDataVencimento: Date = new Date(contractAtualizado.vencimentoEm);

          if (principalAtual > 0) {
            const dataBase: Date = new Date(contractAtualizado.vencimentoEm);
            const diaOriginal: number = dataBase.getUTCDate();
            dataBase.setUTCMonth(dataBase.getUTCMonth() + 1);
            if (dataBase.getUTCDate() !== diaOriginal) {
              dataBase.setUTCDate(0);
            }
            novaDataVencimento = dataBase;
          }

          // Registra no histórico com os valores de juros e principal perfeitamente mapeados
          await tx.paymentHistory.create({
            data: {
              contractId,
              createdByUserId: userId,
              tipo: data.tipo,
              valorPago: Number(data.valorPago),
              pagoPrincipal: pagoPrincipalAcumulado,
              pagoTaxa: pagoTaxaAcumulado,
              pagoJuros: pagoJurosAcumulado,
              multaCobrada: pagoTaxaAcumulado,
              observacao: data.observacao || "",
              dataPagamento: new Date(),
              dataReferencia: dataReferenciaAuditoria,
            },
          });

          // Atualiza o contrato aplicando as mudanças na estrutura de campos correta
          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorPrincipal: principalAtual, // Reduz o capital principal
              valorEmAberto: novoValorEmAberto, // Reduz o montante total
              taxa: taxaAtual,
              vencimentoEm: novaDataVencimento,
              status: novoValorEmAberto <= 0 && taxaAtual <= 0 ? "QUITADO" : "ABERTO",
            },
          });

        } else {
          /* ---------------------------------------------------------
              CENÁRIO B: CONTRATO PARCELADO (INSTALLMENTS) - INTACTO 🔒
          --------------------------------------------------------- */
          for (const parcela of contractAtualizado.installments) {
            if (saldoParaAbater <= 0) break;

            let valorParcelaRestante: number = Number(parcela.valor);
            let taxaParcelaRestante: number = Number(parcela.taxa);
            const jurosPercent: number = Number(contractAtualizado.jurosPercent || 0);

            // 1. Abate Taxa da Parcela
            if (taxaParcelaRestante > 0 && limiteTaxaRestante > 0) {
              const abatimentoTaxa: number = Math.min(
                saldoParaAbater,
                taxaParcelaRestante,
                limiteTaxaRestante,
              );
              taxaParcelaRestante -= abatimentoTaxa;
              saldoParaAbater -= abatimentoTaxa;
              limiteTaxaRestante -= abatimentoTaxa;
              pagoTaxaAcumulado += abatimentoTaxa;
            }

            // 2. Separa Juros embutido na Parcela
            if (saldoParaAbater > 0 && valorParcelaRestante > 0) {
              const fatorJuros: number = jurosPercent / (100 + jurosPercent);
              const totalJurosNaParcela: number = valorParcelaRestante * fatorJuros;
              const totalPrincipalNaParcela: number = valorParcelaRestante - totalJurosNaParcela;

              const abatimentoJuros: number = Math.min(saldoParaAbater, totalJurosNaParcela);
              pagoJurosAcumulado += abatimentoJuros;
              saldoParaAbater -= abatimentoJuros;

              const abatimentoPrincipal: number = Math.min(saldoParaAbater, totalPrincipalNaParcela);
              pagoPrincipalAcumulado += abatimentoPrincipal;
              saldoParaAbater -= abatimentoPrincipal;

              valorParcelaRestante -= (abatimentoJuros + abatimentoPrincipal);
            }

            await tx.contractInstallment.update({
              where: { id: parcela.id },
              data: {
                valor: valorParcelaRestante,
                taxa: taxaParcelaRestante,
                status: valorParcelaRestante <= 0 && taxaParcelaRestante <= 0 ? "PAGO" : "PENDENTE",
                dataPagamento: valorParcelaRestante <= 0 && taxaParcelaRestante <= 0 ? new Date() : null,
              },
            });
          }

          const todasParcelas = await tx.contractInstallment.findMany({
            where: { contractId },
          });

          const novoSaldoPrincipal: number = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.valor), 0);

          const novoSaldoTaxa: number = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.taxa), 0);

          const proximaParcelaPendente = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .sort((a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())[0];

          const novoVencimentoContrato: Date = proximaParcelaPendente
            ? new Date(proximaParcelaPendente.dataVencimento)
            : new Date(contractAtualizado.vencimentoEm);

          await tx.paymentHistory.create({
            data: {
              contractId,
              createdByUserId: userId,
              tipo: "MISTO",
              valorPago: Number(data.valorPago),
              pagoPrincipal: pagoPrincipalAcumulado,
              pagoTaxa: pagoTaxaAcumulado,
              pagoJuros: pagoJurosAcumulado,
              multaCobrada: pagoTaxaAcumulado,
              observacao: data.observacao || "",
              dataPagamento: new Date(),
              dataReferencia: dataReferenciaAuditoria,
            },
          });

          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorEmAberto: novoSaldoPrincipal,
              taxa: novoSaldoTaxa,
              vencimentoEm: novoVencimentoContrato,
              status: novoSaldoPrincipal <= 0 && novoSaldoTaxa <= 0 ? "QUITADO" : "ABERTO",
            },
          });
        }

        // =========================================================
        // 🆕 DEVOLUÇÃO AO CAIXA (Mantido Intacto e Protegido)
        // =========================================================
        if (pagoPrincipalAcumulado > 0) {
          await tx.user.update({
            where: { id: userId },
            data: {
              saldoOperacional: { increment: pagoPrincipalAcumulado }
            }
          });
        }

      },
      { timeout: 20000 },
    );
  }
  /* ===============================
     📊 SUMMARY FINANCEIRO (AJUSTADO & CORRIGIDO)
    =============================== */
  static async financeSummary(startDate: Date, endDate: Date, userId: string) {
    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    // 1. TOTAL EMPRESTADO
    const activeContractsGrouped = await prisma.contract.groupBy({
      by: ["periodicity"],
      where: {
        userId,
        status: { not: "QUITADO" },
      },
      _sum: { valorPrincipal: true },
    });

    let emprestadoDiario = 0;
    let emprestadoSemanal = 0;
    let emprestadoMensal = 0;

    activeContractsGrouped.forEach((group) => {
      const valor = Number(group._sum.valorPrincipal || 0);
      if (group.periodicity === "DAILY") emprestadoDiario = valor;
      else if (group.periodicity === "WEEKLY") emprestadoSemanal = valor;
      else if (group.periodicity === "MONTHLY") emprestadoMensal = valor;
    });

    const totalEmprestado = emprestadoDiario + emprestadoSemanal + emprestadoMensal;

    // 2. TOTAL RECEBIDO (Ajuste de Lógica aqui)
    const receivedMonthly = await prisma.paymentHistory.aggregate({
      where: {
        createdByUserId: userId,
        dataPagamento: { gte: start, lt: end },
        contract: { periodicity: "MONTHLY" },
      },
      _sum: { valorPago: true, pagoTaxa: true },
    });

    const receivedInstallments = await prisma.paymentHistory.aggregate({
      where: {
        createdByUserId: userId,
        dataPagamento: { gte: start, lt: end },
        contract: { periodicity: { not: "MONTHLY" } },
      },
      _sum: { valorPago: true, pagoTaxa: true },
    });

    // Valores brutos vindos do banco
    const brutoMensal = Number(receivedMonthly._sum.valorPago || 0);
    const brutoParcelas = Number(receivedInstallments._sum.valorPago || 0);

    const taxasMensal = Number(receivedMonthly._sum.pagoTaxa || 0);
    const taxasParcelas = Number(receivedInstallments._sum.pagoTaxa || 0);

    // CORREÇÃO: Subtraímos as taxas do valor pago para separar as categorias
    const viaMensalLimpo = brutoMensal - taxasMensal;
    const viaParcelasLimpo = brutoParcelas - taxasParcelas;
    const totalTaxasPagas = taxasMensal + taxasParcelas;

    // O Total agora é a soma simples dos componentes separados
    const totalRecebido = viaMensalLimpo + viaParcelasLimpo + totalTaxasPagas;

    // 3. A RECEBER: PARCELAS
    const installmentsDueList = await prisma.contractInstallment.findMany({
      where: {
        dataVencimento: { gte: start, lt: end },
        status: "PENDENTE",
        contract: {
          userId,
          status: { not: "QUITADO" },
          periodicity: { not: "MONTHLY" },
        },
      },
      select: {
        valor: true,
        contract: { select: { jurosPercent: true } },
      },
    });

    let valorTotalParcelas = 0;
    let jurosEmbutidoDiarioSemanal = 0;

    installmentsDueList.forEach((inst) => {
      const valorParcela = Number(inst.valor || 0);
      valorTotalParcelas += valorParcela;

      const taxa = Number(inst.contract?.jurosPercent || 0);
      if (taxa > 0) {
        const fatorJuros = taxa / (100 + taxa);
        jurosEmbutidoDiarioSemanal += valorParcela * fatorJuros;
      }
    });

    // 4. A RECEBER: MENSAL
    const monthlyContractsDue = await prisma.contract.findMany({
      where: {
        userId,
        periodicity: "MONTHLY",
        vencimentoEm: { gte: start, lt: end },
        status: { not: "QUITADO" },
      },
      select: { valorPrincipal: true, jurosPercent: true, taxa: true },
    });

    let jurosMensalPrevisto = 0;
    let taxasMensaisPendentes = 0;
    let principalMensalPendente = 0;

    monthlyContractsDue.forEach((c) => {
      const principal = Number(c.valorPrincipal || 0);
      const juros = principal * (Number(c.jurosPercent || 0) / 100);

      principalMensalPendente += principal;
      jurosMensalPrevisto += juros;
      taxasMensaisPendentes += Number(c.taxa || 0);
    });

    const jurosETaxasAReceber = jurosMensalPrevisto + jurosEmbutidoDiarioSemanal + taxasMensaisPendentes;

    const totalMontanteAReceber =
      valorTotalParcelas +
      principalMensalPendente +
      (jurosMensalPrevisto + taxasMensaisPendentes);

    return {
      totalEmprestado,
      subTotalEmprestado: {
        diario: emprestadoDiario,
        semanal: emprestadoSemanal,
        mensal: emprestadoMensal,
      },
      jurosETaxasAReceber,
      subJurosAReceber: {
        jurosMensal: jurosMensalPrevisto,
        jurosParcelado: jurosEmbutidoDiarioSemanal,
        taxas: taxasMensaisPendentes,
      },
      totalMontanteAReceber,
      subMontanteAReceber: {
        parcelas: valorTotalParcelas,
        mensal: principalMensalPendente + jurosMensalPrevisto + taxasMensaisPendentes,
      },
      totalRecebido,
      subTotalRecebido: {
        viaParcelas: viaParcelasLimpo,
        viaMensal: viaMensalLimpo,
        viaTaxas: totalTaxasPagas,
      },
    };
  }

  /* ===============================
        HISTÓRICO DE PAGAMENTOS
  =============================== */
  static async paymentsByPeriod(
    startDate: Date,
    endDate: Date,
    userId: string,
  ) {
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);

    return prisma.paymentHistory.findMany({
      where: {
        createdByUserId: userId, // 🔒 Trava
        dataPagamento: { gte: start, lte: end },
      },
      orderBy: { dataPagamento: "desc" },
      include: {
        contract: {
          select: {
            id: true,
            vencimentoEm: true,
            jurosPercent: true,
            valorPrincipal: true,
            periodicity: true,
            client: { select: { nome: true } },
          },
        },
        createdByUser: {
          select: { id: true, nome: true, email: true },
        },
      },
    });
  }
}

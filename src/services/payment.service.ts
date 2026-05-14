import { endOfDay, startOfDay, addDays } from "date-fns";
import { prisma } from "../lib/prisma";
import { AppError } from "../middlewares/error.middleware";
import { ContractService } from "./contract.service";

type PaymentType = "JUROS" | "PRINCIPAL" | "MISTO";

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
          🗑️ EXCLUSÃO DE PAGAMENTO (ESTORNO)
          - Reverte o saldoEmAberto do contrato
          - Reverte o status do contrato/parcela
          - Deleta o registro de histórico
       ========================================================= */
  static async delete(paymentId: string, userId: string) {
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

    const { contractId, pagoPrincipal, pagoTaxa, contract } = payment;

    return prisma.$transaction(
      async (tx) => {
        /* ---------------------------------------------------------
           CENÁRIO A: CONTRATO MENSAL (MONTHLY)
        --------------------------------------------------------- */
        if (contract.periodicity === "MONTHLY") {
          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorEmAberto: { increment: Number(pagoPrincipal || 0) },
              taxa: { increment: Number(pagoTaxa || 0) },
              status: "ABERTO",
            },
          });
        } else {
          /* ---------------------------------------------------------
             CENÁRIO B: CONTRATO PARCELADO (DAILY / WEEKLY)
          --------------------------------------------------------- */

          // Buscamos as parcelas que estão como PAGAS para este contrato
          // Ordenamos pela data de pagamento desc (reabrindo a última paga primeiro)
          const installmentsPaid = await tx.contractInstallment.findMany({
            where: {
              contractId,
              status: "PAGO"
            },
            orderBy: { numeroParcela: "desc" },
          });

          let principalRestanteParaEstornar = Number(pagoPrincipal || 0);

          for (const inst of installmentsPaid) {
            if (principalRestanteParaEstornar <= 0) break;

            const valorParcela = Number(inst.valor || 0);

            // Reabre a parcela: Se o valor do estorno cobre a parcela, ela volta a ser PENDENTE
            // Caso contrário, em sistemas complexos haveria saldo parcial, aqui simplificamos para reabertura total
            await tx.contractInstallment.update({
              where: { id: inst.id },
              data: {
                status: "PENDENTE",
                dataPagamento: null,
              },
            });

            principalRestanteParaEstornar -= valorParcela;
          }

          // Atualiza o contrato pai para manter a consistência do Summary
          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorEmAberto: { increment: Number(pagoPrincipal || 0) },
              taxa: { increment: Number(pagoTaxa || 0) },
              status: "ABERTO",
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
    data: {
      tipo: PaymentType;
      valorPago: number;
      observacao?: string;
      valorDestinadoTaxa?: number;
    },
    userId: string,
  ) {
    // 1. Validação Inicial
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, userId },
    });

    if (!contract) throw new AppError("Contrato não encontrado", 404);

    // 2. Busca o estado atual com parcelas ordenadas
    const contractAtualizado = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        installments: {
          where: { status: "PENDENTE" },
          orderBy: { numeroParcela: "asc" },
        },
      },
    });

    if (!contractAtualizado)
      throw new AppError("Erro ao processar contrato", 500);

    // 3. Inicia Transação
    return prisma.$transaction(
      async (tx) => {
        let saldoParaAbater = Number(data.valorPago);
        let pagoTaxaAcumulado = 0;
        let pagoPrincipalAcumulado = 0; // <--- O valor que vamos devolver ao caixa está aqui
        let pagoJurosAcumulado = 0;

        // 🎯 DEFINIÇÃO DA DATA DE REFERÊNCIA (COMPETÊNCIA)
        let dataReferenciaAuditoria: Date;

        if (contractAtualizado.periodicity === "MONTHLY") {
          dataReferenciaAuditoria = contractAtualizado.vencimentoEm;
        } else {
          dataReferenciaAuditoria =
            contractAtualizado.installments[0]?.dataVencimento || new Date();
        }

        let limiteTaxaRestante =
          data.valorDestinadoTaxa !== undefined
            ? Number(data.valorDestinadoTaxa)
            : saldoParaAbater;

        /* ---------------------------------------------------------
           CENÁRIO A: CONTRATO MENSAL (MONTHLY)
        --------------------------------------------------------- */
        if (contractAtualizado.periodicity === "MONTHLY") {
          let taxaAtual = Number(contractAtualizado.taxa);
          let principalAtual = Number(contractAtualizado.valorEmAberto);
          const jurosPercent = Number(contractAtualizado.jurosPercent || 0);

          if (taxaAtual > 0 && limiteTaxaRestante > 0) {
            const abatimento = Math.min(
              saldoParaAbater,
              taxaAtual,
              limiteTaxaRestante,
            );
            pagoTaxaAcumulado = abatimento;
            saldoParaAbater -= abatimento;
            taxaAtual -= abatimento;
          }

          if (saldoParaAbater > 0 && jurosPercent > 0) {
            const valorJurosCalculado = principalAtual * (jurosPercent / 100);
            const abatimentoJuros = Math.min(
              saldoParaAbater,
              valorJurosCalculado,
            );
            pagoJurosAcumulado = abatimentoJuros;
            saldoParaAbater -= abatimentoJuros;
          }

          if (saldoParaAbater > 0) {
            const abatimentoPrincipal = Math.min(
              saldoParaAbater,
              principalAtual,
            );
            pagoPrincipalAcumulado = abatimentoPrincipal;
            saldoParaAbater -= abatimentoPrincipal;
            principalAtual -= abatimentoPrincipal;
          }

          // 4. Lógica de Renovação de Data (Rollover)
          let novaDataVencimento = contractAtualizado.vencimentoEm;

          if (principalAtual > 0) {
            const dataBase = new Date(contractAtualizado.vencimentoEm);
            const diaOriginal = dataBase.getUTCDate();
            dataBase.setUTCMonth(dataBase.getUTCMonth() + 1);
            if (dataBase.getUTCDate() !== diaOriginal) {
              dataBase.setUTCDate(0);
            }
            novaDataVencimento = dataBase;
          }

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

          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorEmAberto: principalAtual,
              taxa: taxaAtual,
              vencimentoEm: novaDataVencimento,
              status:
                principalAtual <= 0 && taxaAtual <= 0 ? "QUITADO" : "ABERTO",
            },
          });
        } else {
          /* ---------------------------------------------------------
             CENÁRIO B: CONTRATO PARCELADO (INSTALLMENTS)
          --------------------------------------------------------- */
          for (const parcela of contractAtualizado.installments) {
            if (saldoParaAbater <= 0) break;

            let valorParcelaRestante = Number(parcela.valor);
            let taxaParcelaRestante = Number(parcela.taxa);
            const jurosPercent = Number(contractAtualizado.jurosPercent || 0);

            // 1. Abate Taxa da Parcela
            if (taxaParcelaRestante > 0 && limiteTaxaRestante > 0) {
              const abatimentoTaxa = Math.min(
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
              const fatorJuros = jurosPercent / (100 + jurosPercent);
              const totalJurosNaParcela = valorParcelaRestante * fatorJuros;
              const totalPrincipalNaParcela =
                valorParcelaRestante - totalJurosNaParcela;

              const abatimentoJuros = Math.min(
                saldoParaAbater,
                totalJurosNaParcela,
              );
              pagoJurosAcumulado += abatimentoJuros;
              saldoParaAbater -= abatimentoJuros;

              const abatimentoPrincipal = Math.min(
                saldoParaAbater,
                totalPrincipalNaParcela,
              );
              pagoPrincipalAcumulado += abatimentoPrincipal;
              saldoParaAbater -= abatimentoPrincipal;

              valorParcelaRestante -= abatimentoJuros + abatimentoPrincipal;
            }

            await tx.contractInstallment.update({
              where: { id: parcela.id },
              data: {
                valor: valorParcelaRestante,
                taxa: taxaParcelaRestante,
                status:
                  valorParcelaRestante <= 0 && taxaParcelaRestante <= 0
                    ? "PAGO"
                    : "PENDENTE",
                dataPagamento:
                  valorParcelaRestante <= 0 && taxaParcelaRestante <= 0
                    ? new Date()
                    : null,
              },
            });
          }

          const todasParcelas = await tx.contractInstallment.findMany({
            where: { contractId },
          });

          const novoSaldoPrincipal = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.valor), 0);

          const novoSaldoTaxa = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.taxa), 0);

          // 🆕 LÓGICA DE ATUALIZAÇÃO DO VENCIMENTO
          const proximaParcelaPendente = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .sort(
              (a, b) =>
                new Date(a.dataVencimento).getTime() -
                new Date(b.dataVencimento).getTime(),
            )[0];

          const novoVencimentoContrato = proximaParcelaPendente
            ? proximaParcelaPendente.dataVencimento
            : contractAtualizado.vencimentoEm;

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
              status:
                novoSaldoPrincipal <= 0 && novoSaldoTaxa <= 0
                  ? "QUITADO"
                  : "ABERTO",
            },
          });
        }

        // =========================================================
        // 🆕 AQUI ESTÁ A ÚNICA ADIÇÃO: DEVOLUÇÃO AO CAIXA
        // =========================================================
        if (pagoPrincipalAcumulado > 0) {
          // Assumindo que sua tabela de caixa se chama 'balance' e é vinculada pelo userId
          // Se for na tabela 'user', troque 'tx.balance' por 'tx.user'
          await tx.user.update({
            where: { id: userId },
            data: {
              saldoOperacional: { increment: pagoPrincipalAcumulado }
            }
          });
        }
        // =========================================================

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

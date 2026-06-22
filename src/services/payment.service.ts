import { endOfDay, startOfDay, addDays } from "date-fns";
import { prisma } from "../lib/prisma";
import { AppError } from "../middlewares/error.middleware";
import { ContractService } from "./contract.service";
import type { Prisma } from "../generated/prisma/client";

// 🔥 Adicionado o tipo PERSONALIZADO para validações e relatórios
type PaymentType = "JUROS" | "PRINCIPAL" | "MISTO" | "PERSONALIZADO";

interface AmortizePaymentInput {
  tipo: PaymentType;
  valorPago: number;             // O total geral pago
  valorDestinadoPrincipal: number; // O que vai para o Principal
  valorDestinadoJuros: number;     // O que vai para os Juros
  valorDestinadoTaxa: number;      // O que vai para a Taxa
  observacao?: string;
}

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
       🗑️ EXCLUSÃO DE PAGAMENTO (ESTORNO) - VERSÃO CORRIGIDA
       - Valida Contrato Mensal (Reset de Rollover e Juros)
       - Valida Contrato Parcelado (Restauração Cirúrgica por Meta)
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

    // Mantido exatamente como o seu original (Sua desestruturação está correta!)
    const { contractId, pagoPrincipal, pagoJuros, pagoTaxa, contract } = payment;

    // 2. Inicia a transação para garantir consistência total nos estornos
    return prisma.$transaction(
      async (tx) => {
        const principalEstorno = Number(pagoPrincipal || 0);
        const jurosEstorno = Number(pagoJuros || 0);
        const taxaEstorno = Number(pagoTaxa || 0);
        const totalEstornoValor = principalEstorno + jurosEstorno;

        /* ---------------------------------------------------------
           CENÁRIO A: CONTRATO MENSAL (MONTHLY) - RESET DE ROLLOVER 🦾
        --------------------------------------------------------- */
        if (contract.periodicity === "MONTHLY") {
          // Volta o relógio para o vencimento original da competência antes da virada
          const dataVencimentoOriginal = payment.dataReferencia
            ? new Date(payment.dataReferencia)
            : contract.vencimentoEm;

          // Restaura o valor principal que existia antes desse pagamento
          const novoPrincipal = Number(contract.valorPrincipal) + principalEstorno;

          // Recalcula exatamente o juro do mês que foi estornado (evitando o acúmulo da virada)
          const jurosPercent = Number(contract.jurosPercent || 0);
          const jurosDoMesOriginal = novoPrincipal * (jurosPercent / 100);

          // O valor em aberto volta a ser o Principal Original + os Juros devidos daquela data
          const novoValorEmAberto = novoPrincipal + jurosDoMesOriginal;

          // Determina como a taxa deve voltar ao estado anterior
          let acaoTaxa: any = { increment: taxaEstorno };

          if (payment.tipo === "PERSONALIZADO" && payment.observacao) {
            const match = payment.observacao.match(/\[META:TAXA_ORIGINAL=([\d.]+)\]/);
            if (match) {
              const taxaOriginal = Number(match[1]);
              acaoTaxa = taxaOriginal;
            }
          }

          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorPrincipal: novoPrincipal,
              valorEmAberto: novoValorEmAberto,
              taxa: acaoTaxa,
              vencimentoEm: dataVencimentoOriginal,
              status: "ABERTO",
            },
          });
        } else {
          /* ---------------------------------------------------------
             CENÁRIO B: CONTRATO PARCELADO (DAILY / WEEKLY) - CIRÚRGICO 🎯
          --------------------------------------------------------- */
          let restauradoPorMeta = false;

          // Tenta rastrear o estorno pelos metadados cirúrgicos injetados no pagamento/amortização
          if (payment.observacao) {
            const matchParcelas = payment.observacao.match(/\[META:PARCELAS=([^\]]+)\]/);
            // Tenta rastrear o estorno pelos metadados cirúrgicos injetados no pagamento/amortização
            if (payment.observacao) {
              const matchParcelas = payment.observacao.match(/\[META:PARCELAS=([^\]]+)\]/);

              // CORREÇÃO AQUI: Verifica se o match foi bem-sucedido antes de dar o split
              if (matchParcelas && matchParcelas[1]) {
                const tokens = matchParcelas[1].split("|");
                for (const token of tokens) {
                  if (!token) continue;
                  const [instId, vAbatido, tAbatido] = token.split(":");
                  const valInc = Number(vAbatido || 0);
                  const taxInc = Number(tAbatido || 0);

                  if (instId) {
                    const instAtual = await tx.contractInstallment.findUnique({ where: { id: instId } });
                    if (instAtual) {
                      const novoValorInst = Number(instAtual.valor) + valInc;
                      const novaTaxaInst = Number(instAtual.taxa) + taxInc;

                      await tx.contractInstallment.update({
                        where: { id: instId },
                        data: {
                          valor: novoValorInst,
                          taxa: novaTaxaInst,
                          status: novoValorInst <= 0 && novaTaxaInst <= 0 ? "PAGO" : "PENDENTE",
                          dataPagamento: novoValorInst <= 0 && novaTaxaInst <= 0 ? instAtual.dataPagamento : null,
                        },
                      });
                    }
                  }
                }
                restauradoPorMeta = true;
              }
            }
          }

          // Fallback seguro caso seja um pagamento legado antigo (sem a tag de metadados)
          if (!restauradoPorMeta) {
            const installmentsPaid = await tx.contractInstallment.findMany({
              where: { contractId, status: "PAGO" },
              orderBy: { numeroParcela: "desc" },
            });

            let valorRestanteParaEstornar = totalEstornoValor;
            let taxaRestanteParaEstornar = taxaEstorno;

            for (const inst of installmentsPaid) {
              if (valorRestanteParaEstornar <= 0 && taxaRestanteParaEstornar <= 0) break;

              await tx.contractInstallment.update({
                where: { id: inst.id },
                data: {
                  status: "PENDENTE",
                  dataPagamento: null,
                  valor: { increment: valorRestanteParaEstornar },
                  taxa: { increment: taxaRestanteParaEstornar }
                },
              });

              valorRestanteParaEstornar = 0;
              taxaRestanteParaEstornar = 0;
            }
          }

          // Recalcula de forma consolidada o estado do contrato baseado em todas as parcelas atuais
          const todasParcelas = await tx.contractInstallment.findMany({
            where: { contractId },
          });

          const novoSaldoPrincipal = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.valor), 0);

          const novoSaldoTaxa = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.taxa), 0);

          const primeiraParcelaPendente = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .sort((a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())[0];

          const novoVencimentoContrato = primeiraParcelaPendente?.dataVencimento
            ? new Date(primeiraParcelaPendente.dataVencimento)
            : contract.vencimentoEm;

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

        /* ---------------------------------------------------------
           💰 ESTORNO DO CAIXA DO USUÁRIO
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
      { timeout: 25000 },
    );
  }
  static async historyByContract(contractId: string, userId: string) {
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, userId },
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

  /* =========================================================
     💰 CRIAÇÃO DE PAGAMENTO COM MAPEAMENTO DE METADADOS
     ========================================================= */
  static async create(contractId: string, data: CreatePaymentInput, userId: string): Promise<void> {
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, userId },
    });

    if (!contract) {
      throw new AppError("Contrato não encontrado", 404);
    }

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

    return prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        let saldoParaAbater: number = Number(data.valorPago);
        let pagoTaxaAcumulado: number = 0;
        let pagoPrincipalAcumulado: number = 0;
        let pagoJurosAcumulado: number = 0;

        let dataReferenciaAuditoria: Date;
        if (contractAtualizado.periodicity === "MONTHLY") {
          dataReferenciaAuditoria = new Date(contractAtualizado.vencimentoEm);
        } else {
          dataReferenciaAuditoria = contractAtualizado.installments[0]?.dataVencimento
            ? new Date(contractAtualizado.installments[0].dataVencimento)
            : new Date();
        }

        let limiteTaxaRestante: number =
          data.valorDestinadoTaxa !== undefined ? Number(data.valorDestinadoTaxa) : saldoParaAbater;

        /* ---------------------------------------------------------
           CENÁRIO A: CONTRATO MENSAL (MONTHLY)
        --------------------------------------------------------- */
        if (contractAtualizado.periodicity === "MONTHLY") {
          const ehPersonalizado = data.valorDestinadoTaxa !== undefined;
          const tipoPagamentoFinal = ehPersonalizado ? "PERSONALIZADO" : data.tipo;
          const taxaOriginalDoBanco = Number(contractAtualizado.taxa || 0);

          let taxaAtual: number = ehPersonalizado ? Number(data.valorDestinadoTaxa) : taxaOriginalDoBanco;
          let principalAtual: number = Number(contractAtualizado.valorPrincipal || 0);
          let totalGeralDevido: number = Number(contractAtualizado.valorEmAberto || 0);

          let jurosAtual: number = Math.max(0, totalGeralDevido - principalAtual);
          const totalMaxDevido: number = taxaAtual + totalGeralDevido;

          if (saldoParaAbater > totalMaxDevido) {
            throw new AppError(
              `O valor enviado (R$ ${saldoParaAbater}) excede o total devedor do contrato (R$ ${totalMaxDevido}).`,
              400
            );
          }

          if (taxaAtual > 0 && limiteTaxaRestante > 0) {
            const abatimento = Math.min(saldoParaAbater, taxaAtual, limiteTaxaRestante);
            pagoTaxaAcumulado = abatimento;
            saldoParaAbater -= abatimento;
            taxaAtual = Math.max(0, taxaAtual - abatimento);
          }

          if (saldoParaAbater > 0 && jurosAtual > 0) {
            const abatimentoJuros = Math.min(saldoParaAbater, jurosAtual);
            pagoJurosAcumulado = abatimentoJuros;
            saldoParaAbater -= abatimentoJuros;
            jurosAtual -= abatimentoJuros;
          }

          if (saldoParaAbater > 0 && principalAtual > 0) {
            const abatimentoPrincipal = Math.min(saldoParaAbater, principalAtual);
            pagoPrincipalAcumulado = abatimentoPrincipal;
            saldoParaAbater -= abatimentoPrincipal;
            principalAtual -= abatimentoPrincipal;
          }

          let novaDataVencimento: Date = new Date(contractAtualizado.vencimentoEm);
          let novoValorEmAberto: number = principalAtual + jurosAtual;

          if (principalAtual > 0) {
            const dataBase = new Date(contractAtualizado.vencimentoEm);
            const diaOriginal = dataBase.getUTCDate();
            dataBase.setUTCMonth(dataBase.getUTCMonth() + 1);
            if (dataBase.getUTCDate() !== diaOriginal) {
              dataBase.setUTCDate(0);
            }
            novaDataVencimento = dataBase;

            const jurosPercent = Number(contractAtualizado.jurosPercent || 0);
            const novosJurosDoMes = principalAtual * (jurosPercent / 100);
            novoValorEmAberto = principalAtual + jurosAtual + novosJurosDoMes;
          }

          const observacaoComMeta = ehPersonalizado
            ? `${data.observacao || ""}[META:TAXA_ORIGINAL=${taxaOriginalDoBanco}]`
            : data.observacao || "";

          await tx.paymentHistory.create({
            data: {
              contractId,
              createdByUserId: userId,
              tipo: tipoPagamentoFinal,
              valorPago: Number(data.valorPago),
              pagoPrincipal: pagoPrincipalAcumulado,
              pagoTaxa: pagoTaxaAcumulado,
              pagoJuros: pagoJurosAcumulado,
              multaCobrada: pagoTaxaAcumulado,
              observacao: observacaoComMeta,
              dataPagamento: new Date(),
              dataReferencia: dataReferenciaAuditoria,
            },
          });

          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorPrincipal: principalAtual,
              valorEmAberto: novoValorEmAberto,
              taxa: taxaAtual,
              vencimentoEm: novaDataVencimento,
              status: novoValorEmAberto <= 0 && taxaAtual <= 0 ? "QUITADO" : "ABERTO",
            },
          });
        } else {
          /* ---------------------------------------------------------
             CENÁRIO B: CONTRATO PARCELADO (DAILY / WEEKLY) - COM RASTREIO
          --------------------------------------------------------- */
          let metaParcelasLog = "";

          for (const parcela of contractAtualizado.installments) {
            if (saldoParaAbater <= 0) break;

            const valorOriginalAntes = Number(parcela.valor);
            const taxaOriginalAntes = Number(parcela.taxa);

            let valorParcelaRestante = valorOriginalAntes;
            let taxaParcelaRestante = taxaOriginalAntes;
            const jurosPercent = Number(contractAtualizado.jurosPercent || 0);

            let abatidoTaxaNestaParcela = 0;
            if (taxaParcelaRestante > 0 && limiteTaxaRestante > 0) {
              abatidoTaxaNestaParcela = Math.min(saldoParaAbater, taxaParcelaRestante, limiteTaxaRestante);
              taxaParcelaRestante -= abatidoTaxaNestaParcela;
              saldoParaAbater -= abatidoTaxaNestaParcela;
              limiteTaxaRestante -= abatidoTaxaNestaParcela;
              pagoTaxaAcumulado += abatidoTaxaNestaParcela;
            }

            let abatidoValorNestaParcela = 0;
            if (saldoParaAbater > 0 && valorParcelaRestante > 0) {
              const fatorJuros = jurosPercent / (100 + jurosPercent);
              const totalJurosNaParcela = valorParcelaRestante * fatorJuros;
              const totalPrincipalNaParcela = valorParcelaRestante - totalJurosNaParcela;

              const abatimentoJuros = Math.min(saldoParaAbater, totalJurosNaParcela);
              pagoJurosAcumulado += abatimentoJuros;
              saldoParaAbater -= abatimentoJuros;

              const abatimentoPrincipal = Math.min(saldoParaAbater, totalPrincipalNaParcela);
              pagoPrincipalAcumulado += abatimentoPrincipal;
              saldoParaAbater -= abatimentoPrincipal;

              abatidoValorNestaParcela = abatimentoJuros + abatimentoPrincipal;
              valorParcelaRestante -= abatidoValorNestaParcela;
            }

            // Se houve alteração na parcela, salvamos nos metadados do log
            if (abatidoValorNestaParcela > 0 || abatidoTaxaNestaParcela > 0) {
              metaParcelasLog += `${parcela.id}:${abatidoValorNestaParcela}:${abatidoTaxaNestaParcela}|`;
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

          const novoSaldoPrincipal = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.valor), 0);

          const novoSaldoTaxa = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.taxa), 0);

          const proximaParcelaPendente = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .sort((a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())[0];

          const novoVencimentoContrato = proximaParcelaPendente
            ? new Date(proximaParcelaPendente.dataVencimento)
            : new Date(contractAtualizado.vencimentoEm);

          const observacaoFinalComMeta = `${data.observacao || ""}[META:PARCELAS=${metaParcelasLog}]`;

          await tx.paymentHistory.create({
            data: {
              contractId,
              createdByUserId: userId,
              tipo: data.tipo || "MISTO",
              valorPago: Number(data.valorPago),
              pagoPrincipal: pagoPrincipalAcumulado,
              pagoTaxa: pagoTaxaAcumulado,
              pagoJuros: pagoJurosAcumulado,
              multaCobrada: pagoTaxaAcumulado,
              observacao: observacaoFinalComMeta,
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

        if (pagoPrincipalAcumulado > 0) {
          await tx.user.update({
            where: { id: userId },
            data: {
              saldoOperacional: { increment: pagoPrincipalAcumulado },
            },
          });
        }
      },
      { timeout: 25000 }
    );
  }

  /* =========================================================
     💸 AMORTIZAÇÃO DE SALDO COM MAPEAMENTO DE METADADOS
     ========================================================= */
  static async amortize(contractId: string, data: AmortizePaymentInput, userId: string): Promise<void> {
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, userId },
    });

    if (!contract) {
      throw new AppError("Contrato não encontrado", 404);
    }

    return prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const contractAtualizado = await tx.contract.findUnique({
          where: { id: contractId },
          include: {
            installments: {
              where: { status: "PENDENTE" },
              orderBy: { numeroParcela: "asc" },
            },
          },
        });

        if (!contractAtualizado) {
          throw new AppError("Erro ao processar contrato na transação", 500);
        }

        const somaPartes =
          Number(data.valorDestinadoPrincipal) + Number(data.valorDestinadoJuros) + Number(data.valorDestinadoTaxa);
        if (Math.abs(somaPartes - Number(data.valorPago)) > 0.01) {
          throw new AppError("A soma do Principal, Juros e Taxa não condiz com o valor total pago.", 400);
        }

        let principalDisponivel = Number(data.valorDestinadoPrincipal);
        let jurosDisponivel = Number(data.valorDestinadoJuros);
        let taxaDisponivel = Number(data.valorDestinadoTaxa);

        const pagoPrincipalAcumulado = principalDisponivel;
        const pagoJurosAcumulado = jurosDisponivel;
        const pagoTaxaAcumulado = taxaDisponivel;

        const dataReferenciaAuditoria =
          contractAtualizado.periodicity === "MONTHLY"
            ? new Date(contractAtualizado.vencimentoEm)
            : contractAtualizado.installments[0]?.dataVencimento
              ? new Date(contractAtualizado.installments[0].dataVencimento)
              : new Date();

        /* ---------------------------------------------------------
           CENÁRIO A: CONTRATO MENSAL (MONTHLY)
        --------------------------------------------------------- */
        if (contractAtualizado.periodicity === "MONTHLY") {
          let principalAtual = Number(contractAtualizado.valorPrincipal || 0);
          let totalGeralDevido = Number(contractAtualizado.valorEmAberto || 0);
          let taxaAtual = Number(contractAtualizado.taxa || 0);

          let jurosAtual = Math.max(0, totalGeralDevido - principalAtual);

          taxaAtual = Math.max(0, taxaAtual - taxaDisponivel);
          jurosAtual = Math.max(0, jurosAtual - jurosDisponivel);
          principalAtual = Math.max(0, principalAtual - principalDisponivel);

          let novaDataVencimento = new Date(contractAtualizado.vencimentoEm);
          let novoValorEmAberto = principalAtual + jurosAtual;

          if (principalAtual > 0) {
            const dataBase = new Date(contractAtualizado.vencimentoEm);
            const diaOriginal = dataBase.getUTCDate();
            dataBase.setUTCMonth(dataBase.getUTCMonth() + 1);
            if (dataBase.getUTCDate() !== diaOriginal) {
              dataBase.setUTCDate(0);
            }
            novaDataVencimento = dataBase;

            const jurosPercent = Number(contractAtualizado.jurosPercent || 0);
            const novosJurosDoMes = principalAtual * (jurosPercent / 100);
            novoValorEmAberto = principalAtual + jurosAtual + novosJurosDoMes;
          }

          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorPrincipal: principalAtual,
              valorEmAberto: novoValorEmAberto,
              taxa: taxaAtual,
              vencimentoEm: novaDataVencimento,
              status: novoValorEmAberto <= 0 && taxaAtual <= 0 ? "QUITADO" : "ABERTO",
            },
          });
        } else {
          /* ---------------------------------------------------------
             CENÁRIO B: CONTRATO PARCELADO (DAILY / WEEKLY) - AMORTIZAÇÃO
          --------------------------------------------------------- */
          let metaParcelasLog = "";

          for (const parcela of contractAtualizado.installments) {
            if (taxaDisponivel <= 0 && jurosDisponivel <= 0 && principalDisponivel <= 0) break;

            const valorOriginalAntes = Number(parcela.valor);
            const taxaOriginalAntes = Number(parcela.taxa);

            let valorParcelaRestante = valorOriginalAntes;
            let taxaParcelaRestante = taxaOriginalAntes;

            const jurosPercent = Number(contractAtualizado.jurosPercent || 0);
            const fatorJuros = jurosPercent / (100 + jurosPercent);

            const totalJurosNaParcela = valorParcelaRestante * fatorJuros;
            const totalPrincipalNaParcela = valorParcelaRestante - totalJurosNaParcela;

            let abatidoTaxaNestaParcela = 0;
            if (taxaDisponivel > 0 && taxaParcelaRestante > 0) {
              abatidoTaxaNestaParcela = Math.min(taxaDisponivel, taxaParcelaRestante);
              taxaParcelaRestante -= abatidoTaxaNestaParcela;
              taxaDisponivel -= abatidoTaxaNestaParcela;
            }

            let jurosAbatidosNestaParcela = 0;
            if (jurosDisponivel > 0 && totalJurosNaParcela > 0) {
              jurosAbatidosNestaParcela = Math.min(jurosDisponivel, totalJurosNaParcela);
              jurosDisponivel -= jurosAbatidosNestaParcela;
            }

            let principalAbatidoNestaParcela = 0;
            if (principalDisponivel > 0 && totalPrincipalNaParcela > 0) {
              principalAbatidoNestaParcela = Math.min(principalDisponivel, totalPrincipalNaParcela);
              principalDisponivel -= principalAbatidoNestaParcela;
            }

            const abatidoValorNestaParcela = jurosAbatidosNestaParcela + principalAbatidoNestaParcela;
            valorParcelaRestante -= abatidoValorNestaParcela;

            if (abatidoValorNestaParcela > 0 || abatidoTaxaNestaParcela > 0) {
              metaParcelasLog += `${parcela.id}:${abatidoValorNestaParcela}:${abatidoTaxaNestaParcela}|`;
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

          const novoSaldoPrincipal = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.valor), 0);

          const novoSaldoTaxa = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .reduce((acc, p) => acc + Number(p.taxa), 0);

          const proximaParcelaPendente = todasParcelas
            .filter((p) => p.status === "PENDENTE")
            .sort((a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())[0];

          const novoVencimentoContrato = proximaParcelaPendente
            ? new Date(proximaParcelaPendente.dataVencimento)
            : new Date(contractAtualizado.vencimentoEm);

          await tx.contract.update({
            where: { id: contractId },
            data: {
              valorEmAberto: novoSaldoPrincipal,
              taxa: novoSaldoTaxa,
              vencimentoEm: novoVencimentoContrato,
              status: novoSaldoPrincipal <= 0 && novoSaldoTaxa <= 0 ? "QUITADO" : "ABERTO",
            },
          });

          // Se for parcelado, força injetar a tag na observação para o estorno ler perfeitamente
          data.observacao = `${data.observacao || "Amortização de saldo"}[META:PARCELAS=${metaParcelasLog}]`;
        }

        await tx.paymentHistory.create({
          data: {
            contractId,
            createdByUserId: userId,
            tipo: data.tipo || "AMORTIZACAO",
            valorPago: Number(data.valorPago),
            pagoPrincipal: pagoPrincipalAcumulado,
            pagoTaxa: pagoTaxaAcumulado,
            pagoJuros: pagoJurosAcumulado,
            multaCobrada: pagoTaxaAcumulado,
            observacao: data.observacao || "Amortização de saldo declarada",
            dataPagamento: new Date(),
            dataReferencia: dataReferenciaAuditoria,
          },
        });

        if (pagoPrincipalAcumulado > 0) {
          await tx.user.update({
            where: { id: userId },
            data: {
              saldoOperacional: { increment: pagoPrincipalAcumulado },
            },
          });
        }
      },
      { timeout: 25000 }
    );
  }

  /* ===============================
         📊 SUMMARY FINANCEIRO
   =============================== */
  static async financeSummary(startDate: Date, endDate: Date, userId: string) {
    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

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
    let emprestadoParcelado = 0; // ✨ Incluído o acumulador do parcelado

    activeContractsGrouped.forEach((group) => {
      const valor = Number(group._sum.valorPrincipal || 0);
      if (group.periodicity === "DAILY") emprestadoDiario = valor;
      else if (group.periodicity === "WEEKLY") emprestadoSemanal = valor;
      else if (group.periodicity === "MONTHLY") emprestadoMensal = valor;
      else if (group.periodicity === "PARCELADO") emprestadoParcelado = valor; // ✨ Incluída a verificação do parcelado
    });

    // ✨ Incluído o 'emprestadoParcelado' na soma total exatamente como antes
    const totalEmprestado = emprestadoDiario + emprestadoSemanal + emprestadoMensal + emprestadoParcelado;

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

    const brutoMensal = Number(receivedMonthly._sum.valorPago || 0);
    const brutoParcelas = Number(receivedInstallments._sum.valorPago || 0);

    const taxasMensal = Number(receivedMonthly._sum.pagoTaxa || 0);
    const taxasParcelas = Number(receivedInstallments._sum.pagoTaxa || 0);

    const viaMensalLimpo = brutoMensal - taxasMensal;
    const viaParcelasLimpo = brutoParcelas - taxasParcelas;
    const totalTaxasPagas = taxasMensal + taxasParcelas;

    const totalRecebido = viaMensalLimpo + viaParcelasLimpo + totalTaxasPagas;

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
        parcelado: emprestadoParcelado, // ✨ Incluído no retorno para o front
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
        HISTÓRICO DE PAGAMENTOS POR PERÍODO
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
        createdByUserId: userId,
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
import { prisma } from "../lib/prisma";
import { AppError } from "../middlewares/error.middleware";
import type { ContractPeriodicity } from "../generated/prisma/enums";
import { WhatsAppService } from "./whatsapp.service";

export class ContractService {
  /* =========================================================
          🛡️ APLICAÇÃO DE TAXAS (CORREÇÃO TAXA DIÁRIA NO MENSAL)
          - Lógica de "Calendar Day" via UTC.
          - Taxa mensal aplicada por DIA de atraso (sem dividir por 30).
          - Filtro estrito: Apenas status ABERTO e ATRASADO geram taxas.
       ========================================================= */
  static async applyPendingTaxes(userId: string) {
    console.log(`\n🚀 [TAX_ENGINE] Iniciando verificação de taxas para o usuário: ${userId}`);
    try {
      const now = new Date();
      const hoje = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
      console.log(`📅 [TAX_ENGINE] Data base 'Hoje' (UTC): ${hoje.toISOString()}`);

      const [taxasConfig, contratos] = await Promise.all([
        prisma.taxa.findMany(),
        prisma.contract.findMany({
          where: {
            userId: userId,
            // AJUSTE AQUI: Garante que QUITADO, COBRANCA_PESSOAL e CALOTEIRO fiquem de fora
            status: { in: ["ABERTO", "ATRASADO"] },
          },
          include: {
            installments: {
              where: { status: "PENDENTE" },
            },
          },
        }),
      ]);

      console.log(`📊 [TAX_ENGINE] Contratos elegíveis encontrados: ${contratos.length}`);
      if (contratos.length === 0) return;

      const updatesPromises: any[] = [];
      const configMap = new Map(taxasConfig.map((t) => [t.type, Number(t.value)]));

      for (const contrato of contratos) {
        console.log(`\n📄 [CONTRATO ${contrato.id}] Tipo: ${contrato.periodicity} | Status Atual: ${contrato.status} | Taxa Atual: ${contrato.taxa}`);

        let novaSomaTaxas = 0;
        const v = new Date(contrato.vencimentoEm);

        if (contrato.periodicity === "MONTHLY") {
          const valorConfig = configMap.get("MONTHLY") || 0;
          console.log(`   [MONTHLY] Valor da taxa por dia de atraso: ${valorConfig}`);

          if (valorConfig > 0) {
            const vencimentoPuro = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), 0, 0, 0));
            console.log(`   [MONTHLY] Vencimento do contrato (UTC): ${vencimentoPuro.toISOString()}`);

            if (vencimentoPuro < hoje) {
              const diffTime = hoje.getTime() - vencimentoPuro.getTime();
              const dias = Math.floor(diffTime / (1000 * 60 * 60 * 24));
              console.log(`   [MONTHLY] Contrato vencido. Dias de atraso calculados: ${dias}`);

              if (dias > 0) {
                novaSomaTaxas = Number((dias * valorConfig).toFixed(2));
                console.log(`   [MONTHLY] Taxa total calculada: ${novaSomaTaxas}`);
              }
            } else {
              console.log(`   [MONTHLY] Contrato em dia ou vence hoje. Nenhuma taxa aplicada.`);
            }
          }
        } else {
          const valorMultaDiaria = configMap.get(contrato.periodicity) || 0;
          console.log(`   [${contrato.periodicity}] Valor da multa diária: ${valorMultaDiaria} | Parcelas pendentes: ${contrato.installments.length}`);

          for (const inst of contrato.installments) {
            let taxaParcelaCalculada = 0;
            const vi = new Date(inst.dataVencimento);
            const vencInstPuro = new Date(Date.UTC(vi.getUTCFullYear(), vi.getUTCMonth(), vi.getUTCDate(), 0, 0, 0));

            if (vencInstPuro < hoje && valorMultaDiaria > 0) {
              const diffTime = hoje.getTime() - vencInstPuro.getTime();
              const dias = Math.floor(diffTime / (1000 * 60 * 60 * 24));
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

        // Mantém a alternância automática apenas entre os dois status permitidos pelo motor de taxas
        const novoStatus = novaSomaTaxas > 0 ? "ATRASADO" : "ABERTO";

        if (Math.abs(novaSomaTaxas - Number(contrato.taxa || 0)) > 0.01 || contrato.status !== novoStatus) {
          console.log(`   📝 [DECISÃO] Atualizando Contrato para Taxa: ${novaSomaTaxas.toFixed(2)} | Status: ${novoStatus}`);
          updatesPromises.push(
            prisma.contract.update({
              where: { id: contrato.id },
              data: { taxa: Number(novaSomaTaxas.toFixed(2)), status: novoStatus },
            })
          );
        } else {
          console.log(`   💤 [DECISÃO] Contrato principal sem alterações pendentes.`);
        }
      }

      if (updatesPromises.length > 0) {
        await Promise.all(updatesPromises);
        console.log(`✅ [TAX_ENGINE] Lote de atualizações concluído.`);
      }
    } catch (e) {
      console.error("\n❌ [TAX_ENGINE_ERROR]", e);
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
      const jurosValor = data.valorPrincipal * (data.jurosPercent / 100);
      const montanteTotal = data.valorPrincipal + jurosValor;

      contractData.valorEmAberto = montanteTotal;

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

    // Executa a transação incluindo o plano do usuário no retorno final
    const contratoCriado = await prisma.$transaction(async (tx) => {
      // 1. Busca os dados do usuário atual (incluindo o plano)
      const user = await tx.user.findUnique({
        where: { id: data.userId },
      });

      if (!user) {
        throw new AppError("Usuário não encontrado.", 404);
      }

      // 🔴 TRAVA DE LIMITE PARA PLANO VAZIO
      if (user.plan === "VAZIO") {
        const contratosAtivosCount = await tx.contract.count({
          where: {
            userId: data.userId,
            status: { not: "QUITADO" },
          },
        });

        if (contratosAtivosCount >= 5) {
          throw new AppError(
            "Usuários no plano gratuito podem ter no máximo 5 contratos ativos simultaneamente. Faça o upgrade para continuar.",
            400
          );
        }
      }

      // 2. Verificação de Saldo Operacional
      const saldoDisponivel = Number(user.saldoOperacional || 0);

      if (saldoDisponivel < data.valorPrincipal) {
        throw new AppError("Saldo insuficiente em caixa.", 400);
      }

      // 3. Deduz o valor do caixa operacional
      await tx.user.update({
        where: { id: data.userId },
        data: {
          saldoOperacional: { decrement: data.valorPrincipal },
        },
      });

      // 4. Efetua a criação do novo contrato
      const novoContrato = await tx.contract.create({
        data: contractData,
        include: { client: true },
      });

      // 🟢 Injeta temporariamente o plano do usuário para usarmos na checagem do WhatsApp abaixo
      return {
        ...novoContrato,
        userPlan: user.plan,
      };
    });

    // =========================================================
    // DISPARO DA MENSAGEM AUTOMÁTICA (PÓS-CRIAÇÃO)
    // =========================================================
    // 🟢 CONDICIONAL DE PLANO: Só envia se for "STARTER" ou "PRO" (Bloqueia se for "VAZIO")
    if (contratoCriado.client?.telefone && contratoCriado.userPlan !== "VAZIO") {
      // Executa o envio em background para não atrasar a resposta da API
      (async () => {
        try {
          const modalidades: Record<string, string> = {
            DAILY: "Diário",
            WEEKLY: "Semanal",
            MONTHLY: "Mensal",
          };

          const formatarMoeda = (v: number) =>
            new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

          const formatarData = (d: Date) =>
            new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(d);

          const nomeCliente = contratoCriado.client.nome;
          const modalidadeStr = modalidades[contratoCriado.periodicity] || contratoCriado.periodicity;
          const valorEmprestadoStr = formatarMoeda(Number(contratoCriado.valorPrincipal));
          const valorTotalStr = formatarMoeda(Number(contratoCriado.valorEmAberto));
          const dataVencimentoStr = formatarData(new Date(contratoCriado.vencimentoEm));

          const idContratoSimplificado = contratoCriado.id.slice(-6).toUpperCase();

          const mensagem = `Olá, ${nomeCliente}.\n\nSeu contrato foi criado com sucesso em nosso sistema.\n\n📄 Informações do contrato:\n\n• Número do contrato: # ${idContratoSimplificado}\n• Modalidade: ${modalidadeStr}\n• Valor emprestado: ${valorEmprestadoStr}\n• Taxa de juros: ${contratoCriado.jurosPercent}%\n• Valor total a pagar: ${valorTotalStr}\n• Data de vencimento: ${dataVencimentoStr}\n\n📌 Informações sobre atraso:\n\n• Contrato Diário → Multa de R$ 5 por dia de atraso\n• Contrato Semanal → Multa de R$ 15 por dia de atraso\n• Contrato Mensal → Multa de R$ 20 por dia de atraso\n\n⚠️ Após o vencimento, as taxas de atraso serão adicionadas automaticamente ao valor em aberto.\n\nQualquer dúvida, estamos à disposição.`;

          await WhatsAppService.sendMessage(
            contratoCriado.userId,
            contratoCriado.client.telefone,
            mensagem
          );

          console.log(`✉️ [Mensagem Automática] Notificação de contrato #${idContratoSimplificado} enviada para ${nomeCliente}`);
        } catch (error: any) {
          console.error(`❌ [WhatsApp] Erro ao enviar mensagem pós-criação:`, error.message);
        }
      })();
    } else if (contratoCriado.userPlan === "VAZIO") {
      console.log(`ℹ️ [Mensagem Ignorada] Usuário no plano VAZIO não possui envio automático de WhatsApp.`);
    }

    // Remove a propriedade temporária para retornar o objeto limpo do contrato
    const { userPlan, ...retornoContrato } = contratoCriado;

    // Retorna exatamente o contrato criado como antes
    return retornoContrato;
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
        client: { select: { nome: true, telefone: true } },
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
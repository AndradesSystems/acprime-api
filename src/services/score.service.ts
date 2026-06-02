import { prisma } from "../lib/prisma";

export class ScoreService {
  /**
   * 🔍 BUSCA DOSSIÊ COMPLETO DE CLIENTES
   * Retorna os dados agregados para os cards superiores, contadores e a listagem de contratos.
   */
  static async buscarClientesComScores(userId: string) {
    const clientes = await prisma.client.findMany({
      where: { userId },
      include: {
        clientScore: true,
        contracts: {
          orderBy: { createdAt: "desc" },
          include: {
            installments: {
              orderBy: { numeroParcela: "asc" }
            },
            payments: {
              orderBy: { dataPagamento: "asc" }
            },
          },
        },
      },
      orderBy: { nome: "asc" },
    });

    // Mapeia os dados devolvendo os cálculos exatos exigidos pelo painel/dossiê
    return clientes.map((cliente) => {
      const contratosDetalhados = cliente.contracts.map((contrato) => {
        // Agregações financeiras por contrato baseadas no histórico de pagamentos
        const totalPagoNoContrato = contrato.payments.reduce((acc, p) => acc + Number(p.valorPago), 0);
        const jurosPagos = contrato.payments.reduce((acc, p) => acc + Number(p.pagoJuros), 0);
        const taxasPagas = contrato.payments.reduce((acc, p) => acc + Number(p.pagoTaxa || p.multaCobrada || 0), 0);
        const principalPago = contrato.payments.reduce((acc, p) => acc + Number(p.pagoPrincipal), 0);

        // 📊 CONTADORES DE PAGAMENTOS (No Prazo vs Atrasados)
        let pagamentosNoPrazo = 0;
        let pagamentosAtrasados = 0;

        contrato.payments.forEach((pagamento) => {
          // Normaliza a data do pagamento para Meia-noite UTC para comparação segura
          const datePag = new Date(pagamento.dataPagamento);
          const pagPuro = new Date(Date.UTC(datePag.getUTCFullYear(), datePag.getUTCMonth(), datePag.getUTCDate()));

          // Tenta encontrar a parcela correspondente usando a dataReferencia se existir, 
          // ou recorre à ordem das parcelas como fallback lógico
          let parcelaCorrespondente = contrato.installments.find((inst) => {
            if (pagamento.dataReferencia) {
              const dateRef = new Date(pagamento.dataReferencia);
              return dateRef.getUTCDate() === new Date(inst.dataVencimento).getUTCDate() &&
                     dateRef.getUTCMonth() === new Date(inst.dataVencimento).getUTCMonth();
            }
            return false;
          });

          // Se não achou por data de referência, faz o cruzamento inteligente por estimativa de períodos
          if (!parcelaCorrespondente) {
            // Mapeia a parcela que possui o vencimento mais próximo/relevante para o pagamento feito
            parcelaCorrespondente = contrato.installments.find((inst) => {
              const dateVenc = new Date(inst.dataVencimento);
              const vencPuro = new Date(Date.UTC(dateVenc.getUTCFullYear(), dateVenc.getUTCMonth(), dateVenc.getUTCDate()));
              // Se foi pago antes ou no dia do vencimento da parcela pendente em questão
              return pagPuro <= vencPuro;
            }) || contrato.installments[0]; // Fallback para a primeira caso não se encaixe
          }

          if (parcelaCorrespondente) {
            const dateVenc = new Date(parcelaCorrespondente.dataVencimento);
            const vencPuro = new Date(Date.UTC(dateVenc.getUTCFullYear(), dateVenc.getUTCMonth(), dateVenc.getUTCDate()));

            if (pagPuro <= vencPuro) {
              pagamentosNoPrazo++;
            } else {
              pagamentosAtrasados++;
            }
          } else {
            // Se o contrato não tiver parcelas salvas por algum motivo, assume o vencimento do contrato pai
            const dateVencContrato = new Date(contrato.vencimentoEm);
            const vencContratoPuro = new Date(Date.UTC(dateVencContrato.getUTCFullYear(), dateVencContrato.getUTCMonth(), dateVencContrato.getUTCDate()));
            
            if (pagPuro <= vencContratoPuro) {
              pagamentosNoPrazo++;
            } else {
              pagamentosAtrasados++;
            }
          }
        });

        return {
          id: contrato.id,
          status: contrato.status,
          periodicidade: contrato.periodicity,
          vencimento: contrato.vencimentoEm,
          dinheiroEmprestado: Number(contrato.valorPrincipal),
          valorEmAbertoAtual: Number(contrato.valorEmAberto),
          taxaAcumuladaInadimplencia: Number(contrato.taxa), 
          taxaDeJurosContratual: Number(contrato.jurosPercent), 
          
          // Métricas extraídas do histórico de pagamentos real
          totalPago: Number(totalPagoNoContrato.toFixed(2)),
          principalPago: Number(principalPago.toFixed(2)),
          jurosPagos: Number(jurosPagos.toFixed(2)),
          taxasPagas: Number(taxasPagas.toFixed(2)),
          totalParcelas: contrato.installments.length,

          // 🟢 NOVOS CONTADORES SOLICITADOS DE HISTÓRICO DE PAGAMENTO
          historicoPagamentos: {
            noPrazo: pagamentosNoPrazo,
            atrasados: pagamentosAtrasados,
            totalLancamentos: contrato.payments.length
          }
        };
      });

      return {
        id: cliente.id,
        nome: cliente.nome,
        cpf: cliente.cpf,
        telefone: cliente.telefone,
        scoreGlobal: cliente.score ? Number(cliente.score) : 300,
        
        painelScore: cliente.clientScore ? {
          valor: cliente.clientScore.valor,
          nivelAnalise: cliente.clientScore.nivelAnalise,
          totalEmprestado: Number(cliente.clientScore.totalEmprestado),
          totalDevolvido: Number(cliente.clientScore.totalPago),
          retornoCapitalPercent: Number(cliente.clientScore.retornoCapital),
          contadores: {
            noPrazo: cliente.clientScore.noPrazo,
            atrasos: cliente.clientScore.atrasos,
            abertas: cliente.clientScore.abertas,
          },
          motivos: cliente.clientScore.motivos,
        } : null,

        contratos: contratosDetalhados,
      };
    });
  }

  /**
   * 📊 MOTOR DE CÁLCULO ATUALIZADO (SCORE 0 A 1000 + CALENDAR DAY CORRIGIDO)
   */
  static async calcularEAtualizarScoresPorUsuario(userId: string): Promise<void> {
    console.log(`📊 [Score Engine] Iniciando recálculo corrigido para o userId: ${userId}`);

    try {
      const clientes = await prisma.client.findMany({
        where: { userId: userId },
        include: {
          contracts: {
            include: {
              installments: true,
              payments: true,
            },
          },
        },
      });

      const now = new Date();
      const hoje = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

      for (const cliente of clientes) {
        const temContratos = cliente.contracts.length > 0;
        let scoreFinal = temContratos ? 500 : 300; 
        const motivos: string[] = [];

        let totalEmprestado = 0;
        let totalPagoGeral = 0; 
        let parcelasNoPrazo = 0;
        let atrasosHistoricos = 0; 
        let atrasosAtuais = 0;     
        let parcelasAbertas = 0;

        let temCalote = false;
        let temAtrasado = false;
        let contratosQuitados = 0;

        cliente.contracts.forEach((contrato) => {
          totalEmprestado += Number(contrato.valorPrincipal);

          const statusContrato = contrato.status?.toUpperCase();
          if (statusContrato === "CALOTEIRO") temCalote = true;
          if (statusContrato === "ATRASADO") temAtrasado = true;
          if (statusContrato === "QUITADO") contratosQuitados++;

          contrato.installments.forEach((inst) => {
            const statusParcela = inst.status?.toUpperCase();

            if (statusParcela === "PAGO") {
              const dataVenc = new Date(inst.dataVencimento);
              const vencPuro = new Date(Date.UTC(dataVenc.getUTCFullYear(), dataVenc.getUTCMonth(), dataVenc.getUTCDate(), 0, 0, 0));
              
              if (inst.dataPagamento) {
                const dataPag = new Date(inst.dataPagamento);
                const pagPuro = new Date(Date.UTC(dataPag.getUTCFullYear(), dataPag.getUTCMonth(), dataPag.getUTCDate(), 0, 0, 0));
                
                if (pagPuro <= vencPuro) {
                  parcelasNoPrazo++;
                } else {
                  atrasosHistoricos++;
                }
              } else {
                parcelasNoPrazo++; 
              }
            } 
            else if (statusParcela === "PENDENTE") {
              const dataVenc = new Date(inst.dataVencimento);
              const vencPuro = new Date(Date.UTC(dataVenc.getUTCFullYear(), dataVenc.getUTCMonth(), dataVenc.getUTCDate(), 0, 0, 0));

              if (vencPuro < hoje) {
                atrasosAtuais++;
              } else {
                parcelasAbertas++;
              }
            }
          });

          contrato.payments.forEach((pagamento) => {
            totalPagoGeral += Number(pagamento.valorPago);
          });
        });

        if (!temContratos) {
          motivos.push("Sem histórico comercial registrado no sistema.");
        } else {
          scoreFinal += 50;
          motivos.push("Histórico comercial ativo no sistema (+50 pts)");
        }

        if (temCalote) {
          scoreFinal -= 450;
          motivos.push("⚠️ Restrição grave: Cliente possui histórico marcado como CALOTEIRO (-450 pts)");
        }

        if (temAtrasado || atrasosAtuais > 0) {
          scoreFinal -= 200;
          motivos.push("⚠️ Possui parcelas indevidas em atraso pendentes (-200 pts)");
        }

        if (atrasosHistoricos > 0) {
          const perdaPorAtrasoAntigo = Math.min(atrasosHistoricos * 15, 150);
          scoreFinal -= perdaPorAtrasoAntigo; 
          motivos.push(`Histórico de ${atrasosHistoricos} parcelas pagas com atraso (-${perdaPorAtrasoAntigo} pts)`);
        }

        if (parcelasNoPrazo > 0) {
          const bonusPontualidade = Math.min(parcelasNoPrazo * 20, 300);
          scoreFinal += bonusPontualidade;
          motivos.push(`Excelente histórico de pontualidade com ${parcelasNoPrazo} parcelas pagas em dia (+${bonusPontualidade} pts)`);
        }

        if (contratosQuitados > 0) {
          const bonusContratos = Math.min(contratosQuitados * 40, 150);
          scoreFinal += bonusContratos;
          motivos.push(`Confiança elevada: ${contratosQuitados} contratos totalmente quitados (+${bonusContratos} pts)`);
        }

        scoreFinal = Math.max(0, Math.min(scoreFinal, 1000));

        let nivelAnalise = "Análise Regular";
        if (!temContratos) nivelAnalise = "Sem Histórico Comercial";
        else if (scoreFinal >= 850) nivelAnalise = "Excelente Pagador";
        else if (scoreFinal >= 700) nivelAnalise = "Análise Consistente";
        else if (scoreFinal >= 400) nivelAnalise = "Risco Moderado";
        else nivelAnalise = "Risco Crítico";

        const retornoCapitalCalculado = totalEmprestado > 0 ? (totalPagoGeral / totalEmprestado) * 100 : 0;
        const totalAtrasosGeral = atrasosHistoricos + atrasosAtuais;

        await prisma.client.update({
          where: { id: cliente.id },
          data: { score: scoreFinal.toString() }
        });

        await prisma.clientScore.upsert({
          where: { clientId: cliente.id },
          update: {
            valor: scoreFinal,
            nivelAnalise,
            totalEmprestado: String(totalEmprestado.toFixed(2)),
            totalPago: String(totalPagoGeral.toFixed(2)),
            retornoCapital: String(Math.min(retornoCapitalCalculado, 100).toFixed(2)), 
            noPrazo: parcelasNoPrazo,
            atrasos: totalAtrasosGeral, 
            abertas: parcelasAbertas,
            motivos
          },
          create: {
            clientId: cliente.id,
            valor: scoreFinal,
            nivelAnalise,
            totalEmprestado: String(totalEmprestado.toFixed(2)),
            totalPago: String(totalPagoGeral.toFixed(2)),
            retornoCapital: String(Math.min(retornoCapitalCalculado, 100).toFixed(2)),
            noPrazo: parcelasNoPrazo,
            atrasos: totalAtrasosGeral,
            abertas: parcelasAbertas,
            motivos
          }
        });
      }

      console.log(`✅ [Score Engine] Recálculo e agrupamentos de dossiê finalizados com sucesso.`);
    } catch (error) {
      console.error(`❌ [Score Engine] Erro ao processar regras de negócio:`, error);
      throw error;
    }
  }
}
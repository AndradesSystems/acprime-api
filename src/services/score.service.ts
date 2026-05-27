import { prisma } from "../lib/prisma";

export class ScoreService {
  /**
   * 🔍 BUSCA TODOS OS CLIENTES DE UM USUÁRIO COM OS SCORES ACOPLADOS
   */
  static async buscarClientesComScores(userId: string) {
    return await prisma.client.findMany({
      where: {
        userId: userId,
      },
      include: {
        clientScore: true,
      },
      orderBy: {
        nome: "asc",
      },
    });
  }

  /**
   * 📊 MOTOR DE CÁLCULO ATUALIZADO E CORRIGIDO
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

      for (const cliente of clientes) {
        // 🔹 AJUSTE 1: Se não tem contrato, o score base de partida é 300. Se tem, começa em 500 neutro.
        const temContratos = cliente.contracts.length > 0;
        let scoreFinal = temContratos ? 500 : 300; 
        const motivos: string[] = [];

        let totalEmprestado = 0;
        let totalPago = 0;
        let parcelasNoPrazo = 0;
        let atrasosHistoricos = 0; 
        let atrasosAtuais = 0;     
        let parcelasAbertas = 0;

        let temCalote = false;
        let temAtrasado = false;
        let contratosQuitados = 0;

        cliente.contracts.forEach((contrato) => {
          totalEmprestado += Number(contrato.valorPrincipal);

          // Padroniza o status do contrato para letras maiúsculas
          const statusContrato = contrato.status?.toUpperCase();
          if (statusContrato === "CALOTEIRO") temCalote = true;
          if (statusContrato === "ATRASADO") temAtrasado = true;
          if (statusContrato === "QUITADO" || statusContrato === "PAGO") contratosQuitados++;

          contrato.installments.forEach((inst) => {
            const statusParcela = inst.status?.toUpperCase();

            // 🔹 AJUSTE 2: Validação flexível dos status das parcelas (PAGO / QUITADO / LIQUIDADO)
            if (statusParcela === "PAGO" || statusParcela === "QUITADO" || statusParcela === "LIQUIDADO") {
              if (inst.dataPagamento && new Date(inst.dataPagamento) <= new Date(inst.dataVencimento)) {
                parcelasNoPrazo++;
              } else {
                atrasosHistoricos++;
              }
            } 
            // Validação flexível para pendentes (PENDENTE / ABERTO / EM_ABERTO)
            else if (statusParcela === "PENDENTE" || statusParcela === "ABERTO" || statusParcela === "EM_ABERTO") {
              const hoje = new Date();
              if (new Date(inst.dataVencimento) < hoje) {
                atrasosAtuais++;
              } else {
                parcelasAbertas++;
              }
            }
          });

          contrato.payments.forEach((pagamento) => {
            totalPago += Number(pagamento.valorPago);
          });
        });

        // --- REGRAS DO MOTOR DE CRÉDITO ---
        if (!temContratos) {
          motivos.push("Nenhum contrato anterior registrado para este cliente. Score inicial limitado.");
        } else {
          // Se ele tem contrato e movimentou dinheiro, adicionamos um pequeno bônus de atividade inicial
          scoreFinal += 50;
          motivos.push("Histórico comercial ativo no sistema (+50 pts)");
        }

        if (temCalote) {
          scoreFinal -= 450;
          motivos.push("⚠️ Restrição grave: Cliente possui histórico marcado como CALOTEIRO (-450 pts)");
        }

        if (temAtrasado || atrasosAtuais > 0) {
          scoreFinal -= 200;
          motivos.push("⚠️ Contratos ativos contendo parcelas em atraso pendentes (-200 pts)");
        }

        if (atrasosHistoricos > 0) {
          const perdaPorAtrasoAntigo = Math.min(atrasosHistoricos * 15, 150);
          scoreFinal -= perdaPorAtrasoAntigo; 
          motivos.push(`Histórico de ${atrasosHistoricos} parcelas quitadas com atraso (-${perdaPorAtrasoAntigo} pts)`);
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

        // Limites Regulamentares
        scoreFinal = Math.max(0, Math.min(scoreFinal, 1000));

        // Determinação do Nível
        let nivelAnalise = "Análise Regular";
        if (!temContratos) nivelAnalise = "Sem Histórico Comercial";
        else if (scoreFinal >= 850) nivelAnalise = "Excelente Pagador";
        else if (scoreFinal >= 700) nivelAnalise = "Análise Consistente";
        else if (scoreFinal >= 400) nivelAnalise = "Risco Moderado";
        else nivelAnalise = "Risco Crítico";

        const retornoCapitalCalculado = totalEmprestado > 0 ? (totalPago / totalEmprestado) * 100 : 0;
        const totalAtrasosGeral = atrasosHistoricos + atrasosAtuais;

        // Atualização persistente no Banco de Dados
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
            totalPago: String(totalPago.toFixed(2)),
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
            totalPago: String(totalPago.toFixed(2)),
            retornoCapital: String(Math.min(retornoCapitalCalculado, 100).toFixed(2)),
            noPrazo: parcelasNoPrazo,
            atrasos: totalAtrasosGeral,
            abertas: parcelasAbertas,
            motivos
          }
        });
      }

      console.log(`✅ [Score Engine] Recálculo refinado concluído com sucesso.`);
    } catch (error) {
      console.error(`❌ [Score Engine] Erro ao processar regras de negócio:`, error);
      throw error;
    }
  }
}
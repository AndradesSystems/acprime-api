import { startOfDay, endOfDay } from 'date-fns';
import { ContractStatus, NegotiationStatus, type NegotiationType } from '../generated/prisma/enums';
import { prisma } from '../lib/prisma';

// Interfaces de Entrada para tipagem forte
interface CreateNegotiationDTO {
  contractId: string;
  valorDesconto: number;
  tipo: NegotiationType;
  qtdParcelas?: number; // Obrigatório apenas se for PARCELADO
  primeiroVencimento: Date;
}

export class NegotiationService {

  /**
   * 1. CRIAR UMA RE-NEGOCIAÇÃO
   * Trata a lógica de fotografia da dívida, cálculo de desconto, parcelamento e trava o contrato.
   */

  async create(data: CreateNegotiationDTO) {
    const { contractId, valorDesconto, tipo, qtdParcelas = 1, primeiroVencimento } = data;

    // Executa tudo dentro de uma transação para segurança total do caixa
    return await prisma.$transaction(async (tx) => {

      // 1.1 - Busca o contrato original com trava de segurança
      const contract = await tx.contract.findUnique({
        where: { id: contractId },
      });

      if (!contract) {
        throw new Error('Contrato não encontrado para negociação.');
      }

      if (contract.status === ContractStatus.QUITADO) {
        throw new Error('Não é possível renegociar um contrato que já foi QUITADO.');
      }

      if (contract.onNegotiation) {
        throw new Error('Este contrato já possui uma negociação ativa em andamento.');
      }

      // 1.2 - Cálculos de valores baseados no estado atual do contrato
      const valorOriginalPrincipal = contract.valorPrincipal;
      const valorOriginalEmAberto = contract.valorEmAberto;
      const valorOriginalTaxa = contract.taxa;
      const originalJurosPercent = contract.jurosPercent;

      // ❗ Dívida Bruta Total = Valor em Aberto + Taxas/Multas Acumuladas
      const dividaTotalBruta = Number(valorOriginalEmAberto) + Number(valorOriginalTaxa);

      // Desconto não pode ser maior do que a própria dívida bruta total
      if (Number(valorDesconto) > dividaTotalBruta) {
        throw new Error('O valor do desconto não pode ser maior do que o valor total da dívida bruta com taxas.');
      }

      // ✅ Cálculo corrigido: O valor acordado agora soma as taxas antes de aplicar o desconto
      const valorAcordado = dividaTotalBruta - Number(valorDesconto);

      // 1.3 - Cria o cabeçalho da Negociação tirando a "Foto" dos valores
      const negotiation = await tx.negotiation.create({
        data: {
          contractId,
          valorOriginalPrincipal,
          valorOriginalEmAberto,
          valorOriginalTaxa,
          originalJurosPercent,
          valorDesconto,
          valorAcordado,
          tipo,
          status: NegotiationStatus.PENDENTE,
        },
      });

      // 1.4 - Geração das Parcelas (À Vista ou Parcelado)
      const installmentsToCreate = [];
      const valorDaParcelaBase = Number((valorAcordado / qtdParcelas).toFixed(2));

      // Ajuste de centavos (dízima) na última parcela se necessário
      const totalCalculado = valorDaParcelaBase * qtdParcelas;
      const diferencaCentavos = Number((valorAcordado - totalCalculado).toFixed(2));

      for (let i = 1; i <= qtdParcelas; i++) {
        const dataVencimento = new Date(primeiroVencimento);
        // Incrementa os meses para cada parcela subsequente
        dataVencimento.setMonth(dataVencimento.getMonth() + (i - 1));

        // Se for a última parcela, joga a diferença de centavos nela
        const valorFinalParcela = i === qtdParcelas
          ? valorDaParcelaBase + diferencaCentavos
          : valorDaParcelaBase;

        installmentsToCreate.push({
          negotiationId: negotiation.id,
          numeroParcela: i,
          valorParcela: valorFinalParcela,
          vencimentoEm: dataVencimento,
          status: NegotiationStatus.PENDENTE,
        });
      }

      // Salva todas as parcelas geradas de uma vez só
      await tx.negotiationInstallment.createMany({
        data: installmentsToCreate,
      });

      // 1.5 - Atualiza o Contrato para congelar cobranças antigas
      await tx.contract.update({
        where: { id: contractId },
        data: {
          status: ContractStatus.NEGOCIADO,
          onNegotiation: true,
          historico: `${contract.historico || ''}\n[${new Date().toLocaleDateString()}] Contrato renegociado em modo ${tipo}.`,
        },
      });

      return negotiation;
    });
  }

  /**
   * 2. LIQUIDAR UMA PARCELA DA NEGOCIAÇÃO
   * Dá baixa na parcela e verifica se o acordo inteiro foi finalizado para quitar o contrato.
   */
  async payInstallment(installmentId: string) {
    return await prisma.$transaction(async (tx) => {

      // 2.1 - Busca a parcela e traz junto os dados da negociação
      const installment = await tx.negotiationInstallment.findUnique({
        where: { id: installmentId },
        include: { negotiation: true },
      });

      if (!installment) {
        throw new Error('Parcela de negociação não encontrada.');
      }

      if (installment.status === NegotiationStatus.PAGO) {
        throw new Error('Esta parcela de acordo já foi paga.');
      }

      // 2.2 - Atualiza o status da parcela específica para PAGO
      await tx.negotiationInstallment.update({
        where: { id: installmentId },
        data: {
          status: NegotiationStatus.PAGO,
          pagoEm: new Date(),
        },
      });

      // 2.3 - Checa se ainda restam parcelas pendentes nessa negociação
      const parcelasAbertas = await tx.negotiationInstallment.count({
        where: {
          negotiationId: installment.negotiationId,
          status: NegotiationStatus.PENDENTE,
        },
      });

      // 2.4 - Se NÃO houver mais parcelas pendentes, o acordo foi 100% cumprido!
      if (parcelasAbertas === 0) {
        // Atualiza a Negociação Pai
        await tx.negotiation.update({
          where: { id: installment.negotiationId },
          data: { status: NegotiationStatus.PAGO },
        });

        // Libera e QUITA o Contrato de forma definitiva no sistema
        await tx.contract.update({
          where: { id: installment.negotiation.contractId },
          data: {
            status: ContractStatus.QUITADO,
            valorEmAberto: 0, // Zera o saldo devedor do contrato
            onNegotiation: false,
          },
        });
      }

      return { message: 'Parcela paga com sucesso!', acordoConcluido: parcelasAbertas === 0 };
    });
  }

  /**
   * 3. BUSCAR HISTÓRICO DE NEGOCIAÇÕES DE UM CONTRATO
   * Retorna os valores do início da dívida lado a lado com os valores renegociados.
   */
  async getByContract(contractId: string) {
    return await prisma.negotiation.findMany({
      where: { contractId },
      include: {
        installments: {
          orderBy: { numeroParcela: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' }, // Traz a negociação mais recente primeiro
    });
  }

  /**
   * 4. QUEBRAR UM ACORDO (OPCIONAL - CRON OU MANUAL)
   * Se o cliente atrasar demais o acordo, o sistema quebra a negociação e ele volta a ser CALOTEIRO.
   */
  async breakNegotiation(negotiationId: string) {
    return await prisma.$transaction(async (tx) => {
      const negotiation = await tx.negotiation.findUnique({
        where: { id: negotiationId },
      });

      if (!negotiation || negotiation.status !== NegotiationStatus.PENDENTE) {
        throw new Error('Negociação inválida para cancelamento/quebra.');
      }

      // Marca a negociação e parcelas abertas como QUEBRADAS
      await tx.negotiation.update({
        where: { id: negotiationId },
        data: { status: NegotiationStatus.QUEBRADO },
      });

      await tx.negotiationInstallment.updateMany({
        where: { negotiationId, status: NegotiationStatus.PENDENTE },
        data: { status: NegotiationStatus.QUEBRADO },
      });

      // O contrato perde o benefício do acordo e volta a ficar sujo (CALOTEIRO)
      await tx.contract.update({
        where: { id: negotiation.contractId },
        data: {
          status: ContractStatus.CALOTEIRO,
          onNegotiation: false,
        },
      });

      return { message: 'O acordo foi quebrado e o contrato voltou para inadimplência.' };
    });
  }


 /**
   * 5. LISTAGEM DE NEGOCIAÇÕES SEM FILTRO DE DATA (GET)
   * Retorna todo o histórico de renegociações dos contratos pertencentes a um usuário específico.
   */
  async get(userId: string, startDate: Date, endDate: Date) {
    console.log(`[NegotiationService.get] Iniciando busca irrestrita de histórico para o userId: ${userId}`);

    try {
      // 1. Busca todos os contratos que pertencem ao usuário (sem travar status)
      const userContracts = await prisma.contract.findMany({
        where: {
          userId: userId,
        },
        select: {
          id: true,
        },
      });

      console.log(
        `[NegotiationService.get] Total de contratos encontrados mapeados para o usuário ${userId}: ${userContracts.length}`
      );

      // 2. Se o usuário não tiver nenhum contrato no sistema, retorna vazio imediatamente
      if (userContracts.length === 0) {
        console.log(`[NegotiationService.get] Usuário não possui contratos cadastrados. Retornando lista vazia.`);
        return [];
      }

      // Extrai os IDs: ['id1', 'id2', ...]
      const contractIds = userContracts.map((c) => c.id);

      // 3. Busca TODAS as negociações desses contratos, incluindo o Cliente através do Contrato
      const negotiations = await prisma.negotiation.findMany({
        where: {
          contractId: {
            in: contractIds,
          },
        },
        include: {
          contract: {
            select: {
              clientId: true,
              status: true,
              // 💡 INCLUÍDO: Busca os dados do cliente associado ao contrato renegociado
              client: {
                select: {
                  nome: true,
                }
              }
            },
          },
          installments: {
            orderBy: { numeroParcela: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' }, // Mantém as mais recentes no topo da tabela
      });

      console.log(
        `[NegotiationService.get] Busca concluída. Total geral de negociações encontradas no histórico: ${negotiations.length}`
      );

      return negotiations;
    } catch (error) {
      console.error(
        `[NegotiationService.get] ERRO ao buscar histórico completo. userId: ${userId} | Mensagem: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }

  /**
   * 6. RESUMO DE MÉTRICAS DAS NEGOCIAÇÕES (SUMMARY)
   * Consolida valores totais, descontos, volumes acordados e agrupamentos por status/tipo da carteira global.
   */
  async summary(userId: string) {
    const baseFilter = {
      contract: {
        userId: userId,
      },
    };

    // Agregações financeiras globais usando recursos nativos do Banco
    const aggregations = await prisma.negotiation.aggregate({
      where: baseFilter,
      _sum: {
        valorOriginalEmAberto: true,
        valorDesconto: true,
        valorAcordado: true,
      },
      _count: {
        id: true,
      },
    });

    // Agrupamento por Status (PENDENTE, CONCLUIDO, QUEBRADO)
    const statusBreakdown = await prisma.negotiation.groupBy({
      by: ['status'],
      where: baseFilter,
      _sum: {
        valorAcordado: true,
      },
    });

    // Filtra e isola dinamicamente os valores acordados de acordo com os status finais mapeados
    const statusConcluido = statusBreakdown.find((s) => s.status === "PAGO");
    const statusQuebrado = statusBreakdown.find((s) => s.status === "QUEBRADO");

    // 💡 Retorna formatado exatamente plano seguindo a tipagem ideal do Dashboard
    return {
      totalAcordado: Number(aggregations._sum.valorAcordado || 0),
      totalDescontos: Number(aggregations._sum.valorDesconto || 0),
      totalRecebido: statusConcluido ? Number(statusConcluido._sum.valorAcordado || 0) : 0,
      totalQuebrado: statusQuebrado ? Number(statusQuebrado._sum.valorAcordado || 0) : 0,
    };
  }
}
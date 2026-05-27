import { prisma } from "../lib/prisma";

// Definindo os tipos válidos de exportação baseados no seu Front-end
export type ExportType = "TOTAL" | "CLIENTES" | "CONTRATOS" | "PAGAMENTOS" | "FINANÇAS";

export class BackupService {
  /**
   * 📦 EXPORTAÇÃO DINÂMICA (TOTAL OU SEGMENTADA) POR USUÁRIO
   */
  static async exportDataByUser(userId: string, type: ExportType) {
    console.log(`💾 [Backup Engine] Iniciando exportação do tipo [${type}] para o usuário: ${userId}`);

    // Inicializa os containers vazios para preenchimento seletivo
    let clients: any[] = [];
    let contracts: any[] = [];
    let installments: any[] = [];
    let payments: any[] = [];
    let expenses: any[] = [];
    let taxas: any[] = [];

    // 1. MÓDULO: CLIENTES (Utilizado no tipo CLIENTES, CONTRATOS, PAGAMENTOS e TOTAL para mapear relações)
    if (type === "TOTAL" || type === "CLIENTES" || type === "CONTRATOS" || type === "PAGAMENTOS") {
      clients = await prisma.client.findMany({
        where: { userId }
      });
    }

    // 2. MÓDULO: CONTRATOS & PARCELAS
    if (type === "TOTAL" || type === "CONTRATOS") {
      contracts = await prisma.contract.findMany({
        where: { userId }
      });

      // Busca as parcelas atreladas aos contratos desse usuário logado
      const contractIds = contracts.map((c) => c.id);
      if (contractIds.length > 0) {
        installments = await prisma.contractInstallment.findMany({
          where: { contractId: { in: contractIds } }
        });
      }
    }

    // 3. MÓDULO: PAGAMENTOS (Histórico de depósitos)
    if (type === "TOTAL" || type === "PAGAMENTOS") {
      // Se já não buscou os contratos no bloco acima, busca os IDs necessários para rastrear os pagamentos
      let contractIds = contracts.map((c) => c.id);
      if (contractIds.length === 0) {
        const userContracts = await prisma.contract.findMany({
          where: { userId },
          select: { id: true }
        });
        contractIds = userContracts.map((c) => c.id);
      }

      if (contractIds.length > 0) {
        payments = await prisma.paymentHistory.findMany({
          where: { contractId: { in: contractIds } }
        });
      }
    }

    // 4. MÓDULO: FINANÇAS (Despesas Pessoais e Taxas da plataforma)
    if (type === "TOTAL" || type === "FINANÇAS") {
      expenses = await prisma.personalExpense.findMany({
        where: { userId }
      });

      taxas = await prisma.taxa.findMany({
        where: { id: userId }
      });
    }

    // Retorna o snapshot estruturado baseado apenas no que foi processado
    return {
      backupDate: new Date().toISOString(),
      exportType: type,
      userId,
      stats: {
        clientes: clients.length,
        contratos: contracts.length,
        parcelas: installments.length,
        pagamentos: payments.length,
        despesas: expenses.length,
        taxas: taxas.length,
      },
      tables: {
        taxas,
        clients,
        personalExpense: expenses,
        contracts,
        contractInstallment: installments,
        paymentHistory: payments,
      },
    };
  }

  /**
   * 🔄 IMPORTAÇÃO INTEGRAL RESTAURADORA
   * Mantida em transação segura para garantir integridade dos dados inseridos
   */
  static async importAllData(backup: any) {
    const { tables, userId } = backup;
    console.log(`📥 [Backup Engine] Iniciando restauração de dados para o usuário: ${userId}`);

    return await prisma.$transaction(async (tx) => {
      try {
        // Se houver contratos mapeados no arquivo de backup, pegamos os IDs para limpar em cascata com segurança
        const existingContracts = await tx.contract.findMany({
          where: { userId },
          select: { id: true }
        });
        const contractIds = existingContracts.map((c) => c.id);

        // 1. LIMPEZA DOS DADOS ANTIGOS APENAS DESTE USUÁRIO LOGADO ⚠️
        console.log("Limpando registros antigos do usuário...");
        if (contractIds.length > 0) {
          await tx.paymentHistory.deleteMany({ where: { contractId: { in: contractIds } } });
          await tx.contractInstallment.deleteMany({ where: { contractId: { in: contractIds } } });
        }
        await tx.contract.deleteMany({ where: { userId } });
        await tx.client.deleteMany({ where: { userId } });
        await tx.personalExpense.deleteMany({ where: { userId } });
        await tx.taxa.deleteMany({ where: { id: userId } });
        console.log("Limpeza isolada concluída.");

        // 2. INSERÇÃO DAS TABELAS RESTAURADAS DE FORMA SEGMENTADA
        if (tables.taxas?.length > 0) {
          console.log(`Inserindo ${tables.taxas.length} taxas...`);
          await tx.taxa.createMany({ data: tables.taxas });
        }

        if (tables.clients?.length > 0) {
          console.log(`Inserindo ${tables.clients.length} clientes...`);
          await tx.client.createMany({ data: tables.clients });
        }

        if (tables.personalExpense?.length > 0) {
          console.log(`Inserindo ${tables.personalExpense.length} despesas...`);
          await tx.personalExpense.createMany({ data: tables.personalExpense });
        }

        if (tables.contracts?.length > 0) {
          console.log(`Inserindo ${tables.contracts.length} contratos...`);
          await tx.contract.createMany({ data: tables.contracts });
        }

        if (tables.contractInstallment?.length > 0) {
          console.log(`Inserindo ${tables.contractInstallment.length} parcelas...`);
          await tx.contractInstallment.createMany({ data: tables.contractInstallment });
        }

        if (tables.paymentHistory?.length > 0) {
          console.log(`Inserindo ${tables.paymentHistory.length} histórico de pagamentos...`);
          await tx.paymentHistory.createMany({ data: tables.paymentHistory });
        }

        console.log("🎉 Restauração de dados efetuada com sucesso!");
        return { success: true, message: "Dados importados e sincronizados com sucesso." };
      } catch (error: any) {
        console.error("❌ ERRO CRÍTICO NA IMPORTAÇÃO:", error.message);
        throw error;
      }
    }, {
      timeout: 60000 // Timeout elástico de 1 minuto para evitar travamentos
    });
  }
}
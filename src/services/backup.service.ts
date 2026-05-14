import { prisma } from "../lib/prisma";

export class BackupService {
  static async exportAllData() {
    const [users, clients, contracts, installments, payments, expenses, taxas] =
      await Promise.all([
        prisma.user.findMany(),
        prisma.client.findMany(),
        prisma.contract.findMany(),
        prisma.contractInstallment.findMany(),
        prisma.paymentHistory.findMany(),
        prisma.personalExpense.findMany(),
        prisma.taxa.findMany(),
      ]);

    return {
      backupDate: new Date().toISOString(),
      // Resumo para conferência rápida
      stats: {
        usuarios: users.length,
        clientes: clients.length,
        contratos: contracts.length,
        parcelas: installments.length,
        pagamentos: payments.length,
        despesas: expenses.length,
        taxas: taxas.length,
      },
      tables: {
        users,
        taxas,
        clients,
        personalExpense: expenses,
        contracts,
        contractInstallment: installments,
        paymentHistory: payments,
      },
    };
  }

 static async importAllData(backup: any) {
    const { tables } = backup;
    console.log("Iniciando processo de importação...");

    return await prisma.$transaction(async (tx) => {
      try {
        // 1. LIMPEZA
        console.log("Limpando tabelas existentes...");
        await tx.paymentHistory.deleteMany();
        await tx.contractInstallment.deleteMany();
        await tx.contract.deleteMany();
        await tx.client.deleteMany();
        await tx.personalExpense.deleteMany();
        await tx.taxa.deleteMany();
        await tx.user.deleteMany();
        console.log("Limpeza concluída.");

        // 2. TRATAMENTO DE USUÁRIOS
        console.log("Preparando usuários...");
        const usersToInsert = tables.users.map((user: any) => {
          // Removemos campos de relação e o 'status' que não existe no model
          const { clients, contracts, expenses, payments, status, ...userData } = user;
          
          return {
            ...userData,
            // Apenas campos que REALMENTE existem no seu schema.prisma atualizado:
            vencimento: user.vencimento ? new Date(user.vencimento) : null,
            tipo: user.tipo || "OPERADOR"
          };
        });

        // 3. INSERÇÃO POR ETAPAS
        console.log(`Inserindo ${usersToInsert.length} usuários...`);
        await tx.user.createMany({ data: usersToInsert });

        console.log(`Inserindo ${tables.taxas.length} taxas...`);
        await tx.taxa.createMany({ data: tables.taxas });

        console.log(`Inserindo ${tables.clients.length} clientes...`);
        await tx.client.createMany({ data: tables.clients });

        console.log(`Inserindo ${tables.personalExpense.length} despesas...`);
        await tx.personalExpense.createMany({ data: tables.personalExpense });

        console.log(`Inserindo ${tables.contracts.length} contratos...`);
        await tx.contract.createMany({ data: tables.contracts });

        console.log(`Inserindo ${tables.contractInstallment.length} parcelas...`);
        await tx.contractInstallment.createMany({ data: tables.contractInstallment });

        console.log(`Inserindo ${tables.paymentHistory.length} histórico...`);
        await tx.paymentHistory.createMany({ data: tables.paymentHistory });

        console.log("Importação finalizada com sucesso!");
      } catch (error: any) {
        console.error("ERRO NA IMPORTAÇÃO:", error.message);
        throw error;
      }
    }, {
      timeout: 60000 
    });
  }
}

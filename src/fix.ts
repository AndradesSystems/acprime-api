import { prisma } from "./lib/prisma";


export async function fixLegacyContracts() {
  console.log("🔄 [Migração] Iniciando validação de contratos legados...");

  try {
    // 1. Busca os contratos ativos que podem ser legados
    const legacyContracts = await prisma.contract.findMany({
      where: {
        status: { in: ["ABERTO", "ATRASADO"] },
      },
      include: {
        client: { select: { nome: true } }
      }
    });

    let updatedCount = 0;

    for (const contract of legacyContracts) {
      const principal = contract.valorPrincipal;       // Já é uma instância de Prisma.Decimal
      const valorEmAbertoAtual = contract.valorEmAberto; // Já é uma instância de Prisma.Decimal
      const jurosPercent = contract.jurosPercent;       // Já é uma instância de Prisma.Decimal

      // No Prisma, para comparar igualdade de Decimals com segurança, usamos .equals()
      if (valorEmAbertoAtual.equals(principal) && jurosPercent.greaterThan(0)) {
        
        // 💡 Lógica matemática com Decimal.js para evitar flutuações e dízimas:
        // valorJuros = principal * (jurosPercent / 100)
        const valorJuros = principal.times(jurosPercent.div(100));
        
        // novoValorEmAberto = principal + valorJuros
        const novoValorEmAberto = principal.plus(valorJuros);

        // 2. Atualiza APENAS o campo valorEmAberto
        await prisma.contract.update({
          where: { id: contract.id },
          data: {
            valorEmAberto: novoValorEmAberto, // O Prisma aceita o próprio objeto Decimal aqui
          },
        });

        console.log(
          `✅ Contrato ${contract.id} (${contract.client?.nome || 'Sem Nome'}): ` +
          `Valor em Aberto corrigido de R$ ${principal.toFixed(2)} para R$ ${novoValorEmAberto.toFixed(2)}`
        );
        
        updatedCount++;
      }
    }

    console.log(`🏁 [Migração] Concluída! Total de contratos antigos atualizados: ${updatedCount}`);
  } catch (error) {
    console.error("❌ [Migração] Erro crítico ao atualizar contratos legados:", error);
  }
}
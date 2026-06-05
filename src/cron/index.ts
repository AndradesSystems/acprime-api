import cron from "node-cron";
import { prisma } from "../lib/prisma"; // Ajuste o caminho relativo se necessário
import { ContractService } from "../services/contract.service"; // Ajuste o caminho relativo

// Importação dos novos serviços especialistas de dentro da própria pasta cron
import { DailyNotificationService } from "./DailyNotificationService";
import { WeeklyNotificationService } from "./WeeklyNotificationService";
import { MonthlyNotificationService } from "./MonthlyNotificationService";

/**
 * Aplica taxas pendentes globais para usuários PRO à meia-noite.
 */
async function runGlobalTaxUpdate(): Promise<void> {
  console.log("💰 [Cron Taxas] Aplicando taxas pendentes globais para usuários PRO...");
  try {
    const users = await prisma.user.findMany({
      where: { plan: "PRO" },
      select: { id: true }
    });

    for (const user of users) {
      await ContractService.applyPendingTaxes(user.id);
    }
    console.log(`✅ [Cron Taxas] Taxas globais processadas com sucesso.`);
  } catch (error) {
    console.error("❌ [Cron Taxas] Erro global ao atualizar taxas:", error);
  }
}

/**
 * Inicializa todos os agendamentos do sistema (Robô Andrade).
 * Configurado para disparar notificações às 22:10 para a fase de testes.
 */
export const initCronJobs = (): void => {
  const TIMEZONE = "America/Sao_Paulo";
  const HORARIO_TESTE = "15 22 * * *"; // Executa às 22:10 diariamente

  // 1. Atualização Monetária de Taxas (Diário - Meia-noite)
  cron.schedule("0 0 * * *", () => {
    runGlobalTaxUpdate();
  }, { timezone: TIMEZONE });

  // 2. Disparo do Fluxo de Contratos Diários
  cron.schedule(HORARIO_TESTE, () => {
    DailyNotificationService.execute();
  }, { timezone: TIMEZONE });

  // 3. Disparo do Fluxo de Contratos Semanais
  cron.schedule(HORARIO_TESTE, () => {
    WeeklyNotificationService.execute();
  }, { timezone: TIMEZONE });

  // 4. Disparo do Fluxo de Contratos Mensais
  cron.schedule(HORARIO_TESTE, () => {
    MonthlyNotificationService.execute();
  }, { timezone: TIMEZONE });

  console.log(`🚀 [MÓDULO CRON] Inicializado com sucesso.`);
  console.log(`🎛️  Rotinas de notificação independentes agendadas para às 22:15 (${TIMEZONE}).`);
};
import cron from "node-cron";
import { prisma } from "../lib/prisma"; // Ajuste o caminho relativo se necessário
import { ContractService } from "../services/contract.service"; // Ajuste o caminho relativo

// Importação dos novos serviços especialistas de dentro da própria pasta cron
import { DailyNotificationService } from "./DailyNotificationService";
import { WeeklyNotificationService } from "./WeeklyNotificationService";
import { MonthlyNotificationService } from "./MonthlyNotificationService";

/**
 * Função utilitária para gerar um delay assíncrono aleatório
 * @param min Segundos mínimos
 * @param max Segundos máximos
 */
const delayAleatorio = (min: number, max: number): Promise<void> => {
  const ms = Math.floor(Math.random() * (max - min + 1) + min) * 1000;
  console.log(`⏳ [Cron Flow] Aguardando uma pausa estratégica de ${(ms / 1000).toFixed(1)} segundos para evitar bloqueio...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

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
 * Executa todas as rotinas de notificação em uma fila indiana rígida (sequencial)
 * com espaçamento aleatório de segurança entre cada módulo.
 */
async function runSequentialNotifications(): Promise<void> {
  console.log("\n⚡ [Cron Flow] Iniciando a esteira sequencial de notificações...");

  // 1. Executa a rotina Diária
  try {
    await DailyNotificationService.execute();
  } catch (err: any) {
    console.error("❌ Erro ao rodar DailyNotificationService:", err.message);
  }

  // Pausa segura de 5 a 30 segundos antes do próximo serviço
  await delayAleatorio(5, 30);

  // 2. Executa a rotina Semanal
  try {
    await WeeklyNotificationService.execute();
  } catch (err: any) {
    console.error("❌ Erro ao rodar WeeklyNotificationService:", err.message);
  }

  // Outra pausa segura de 5 a 30 segundos antes do próximo serviço
  await delayAleatorio(5, 30);

  // 3. Executa a rotina Mensal
  try {
    await MonthlyNotificationService.execute();
  } catch (err: any) {
    console.error("❌ Erro ao rodar MonthlyNotificationService:", err.message);
  }

  console.log("🏁 [Cron Flow] Todas as rotinas de notificações do ciclo foram concluídas!\n");
}

/**
 * Inicializa todos os agendamentos do sistema (Robô Andrade).
 * Configurado para disparar notificações a cada 30 minutos de forma contínua.
 */
export const initCronJobs = (): void => {
  const TIMEZONE = "America/Sao_Paulo";
  
  // 🧭 "*/30" no primeiro campo significa: execute a cada minuto divisível por 30 (0 e 30)
  const INTERVALO_30_MINUTOS = "*/30 * * * *"; 

  // 1. Atualização Monetária de Taxas (Diário - Meia-noite)
  cron.schedule("0 0 * * *", () => {
    runGlobalTaxUpdate();
  }, { timezone: TIMEZONE });

  // 2. Disparador Central Unificado de Notificações (A cada 30 minutos)
  // Evita que as funções rodem simultaneamente no mesmo segundo do node-cron
  cron.schedule(INTERVALO_30_MINUTOS, () => {
    runSequentialNotifications();
  }, { timezone: TIMEZONE });

  console.log(`🚀 [MÓDULO CRON] Inicializado com sucesso.`);
  console.log(`🎛️  Rotina de esteira sequencial agendada para rodar a cada 30 minutos (${TIMEZONE}).`);
};
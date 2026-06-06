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
 * ESTEIRA DA MANHÃ (08:00)
 * Executa Diário, Semanal e Mensal sequencialmente.
 */
async function runMorningNotifications(): Promise<void> {
  console.log("\n☀️ [Cron Flow] Iniciando a esteira sequencial da MANHÃ (08:00)...");

  // 1. Executa a rotina Diária
  try {
    await DailyNotificationService.execute();
  } catch (err: any) {
    console.error("❌ Erro ao rodar DailyNotificationService (Manhã):", err.message);
  }

  await delayAleatorio(5, 30);

  // 2. Executa a rotina Semanal
  try {
    await WeeklyNotificationService.execute();
  } catch (err: any) {
    console.error("❌ Erro ao rodar WeeklyNotificationService:", err.message);
  }

  await delayAleatorio(5, 30);

  // 3. Executa a rotina Mensal
  try {
    await MonthlyNotificationService.execute();
  } catch (err: any) {
    console.error("❌ Erro ao rodar MonthlyNotificationService:", err.message);
  }

  console.log("🏁 [Cron Flow] Todas as rotinas da manhã foram concluídas!\n");
}

/**
 * ESTEIRA DA NOITE (20:00)
 * Executa APENAS a rotina Diária.
 */
async function runEveningNotifications(): Promise<void> {
  console.log("\n🌙 [Cron Flow] Iniciando a esteira da NOITE (20:00)...");

  // Executa APENAS a rotina Diária
  try {
    await DailyNotificationService.execute();
  } catch (err: any) {
    console.error("❌ Erro ao rodar DailyNotificationService (Noite):", err.message);
  }

  console.log("🏁 [Cron Flow] Rotina diária da noite concluída!\n");
}

/**
 * Inicializa todos os agendamentos do sistema (Robô Andrade).
 */
export const initCronJobs = (): void => {
  const TIMEZONE = "America/Sao_Paulo";

  // 1. Atualização Monetária de Taxas (Diário - Meia-noite)
  cron.schedule("0 0 * * *", () => {
    runGlobalTaxUpdate();
  }, { timezone: TIMEZONE });

  // 2. Disparador da Manhã - 08:00 (Roda Diário, Semanal e Mensal)
  cron.schedule("0 8 * * *", () => {
    runMorningNotifications();
  }, { timezone: TIMEZONE });

  // 3. Disparador da Noite - 20:00 (Roda APENAS Diário)
  cron.schedule("0 20 * * *", () => {
    runEveningNotifications();
  }, { timezone: TIMEZONE });

  console.log(`🚀 [MÓDULO CRON] Inicializado com sucesso.`);
  console.log(`🎛️  Configurado para disparos às 08:00 (Geral) e às 20:00 (Apenas Diário) no fuso ${TIMEZONE}.`);
};
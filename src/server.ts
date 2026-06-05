import { app } from "./app";
// 👇 IMPORTANTE: Ajuste o caminho de importação para onde está o seu arquivo cron.jobs.ts
import { initCronJobs } from "./cron"; 
import { prisma } from "./lib/prisma";

const PORT = process.env.PORT || 4004;


app.listen(PORT, async () => {
  console.log(`\n==================================================`);
  console.log(`🚀 [SERVER-START] Servidor rodando na porta ${PORT}`);
  console.log(`==================================================`);
  
  // 🔥 Chamando o inicializador das automações (Robô Andrade, Taxas e Regras de Negócio)
  try {
    initCronJobs();
  } catch (error) {
    console.error("❌ [SERVER-START] Erro ao inicializar agendamentos de Crons:", error);
  }
});
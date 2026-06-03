import cron from "node-cron";
import { isSameDay, addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { prisma } from "./lib/prisma";
import { ContractService } from "./services/contract.service";
import { WhatsAppService } from "./services/whatsapp.service";

// --- CONFIGURAÇÃO DE PRODUÇÃO ---
const isTestMode = false;

// --- FUNÇÃO AUXILIAR DE ESPERA (SLEEP) ---
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- FORMATADOR DE MOEDA COM CONVERSÃO DE DECIMAL ---
const fmt = (v: any) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(typeof v === "object" && v.toNumber ? v.toNumber() : Number(v));

// --- FORMATADOR DE DATA ---
const fmtData = (dateInput: any) => {
  if (!dateInput) return "";
  return format(new Date(dateInput), "dd/MM/yyyy", { locale: ptBR });
};

// --- FUNÇÃO DE MONTAGEM E DISPARO DA NOTIFICAÇÃO ---
async function processarEnvioMensagem(contrato: any, statusEnvio: "ANTES" | "HOJE" | "ATRASADO", turnoNoite: boolean = false): Promise<boolean> {
  // Ajuste de fuso horário civil base (Brasil) para cálculo em memória
  const now = new Date();
  const hoje = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));

  let mensagem = "";
  const nomeCliente = contrato.client?.nome || "Cliente";

  const parcelasOrdenadas = contrato.installments
    ? [...contrato.installments].sort((a: any, b: any) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())
    : [];

  // ----------------------------------------------------
  // LÓGICA: PLANO DIÁRIO (DAILY)
  // ----------------------------------------------------
  if (contrato.periodicity === "DAILY") {
    if (statusEnvio === "ATRASADO" || turnoNoite) {
      const parcelasAtrasadasREAL = parcelasOrdenadas.filter((p: any) => {
        const pVenc = new Date(p.dataVencimento);
        const pVencPuro = new Date(Date.UTC(pVenc.getUTCFullYear(), pVenc.getUTCMonth(), pVenc.getUTCDate(), 0, 0, 0));
        return p.status === "PENDENTE" && pVencPuro < hoje;
      });

      let totalDiario = 0;
      let jurosAcumulado = 0;
      let detalheParcelas = "";

      parcelasAtrasadasREAL.forEach((p: any) => {
        const taxaParcela = Number(p.taxa || 0);
        totalDiario += Number(p.valor);
        jurosAcumulado += taxaParcela;
        detalheParcelas += `• Parcela Nº ${p.numeroParcela} (Vencimento: ${fmtData(p.dataVencimento)}) — Valor: ${fmt(p.valor)} + Multa: ${fmt(taxaParcela)}\n`;
      });

      const valorFinal = totalDiario + jurosAcumulado;

      if (!turnoNoite) {
        mensagem = `⚠️ *AVISO DE ATRASO - PLANO DIÁRIO* ⚠️\n\nOlá, *${nomeCliente}*.\nIdentificamos que você possui parcela(s) diária(s) em atraso:\n\n${detalheParcelas}\n📊 *Resumo Financeiro:*\n• Subtotal das parcelas: ${fmt(totalDiario)}\n• Total de multas acumuladas: ${fmt(jurosAcumulado)}\n💰 *Total Geral Atualizado:* ${fmt(valorFinal)}\n\nPor favor, responda essa mensagem para solicitar a conta de pagamento e regularizar sua situação.`;
      } else {
        mensagem = `Olá, *${nomeCliente}*! Passando para atualizar seu saldo diário desta noite.\n\nSe você ainda não realizou o pagamento hoje, o valor em aberto detalhado com juros é de *${fmt(valorFinal)}*.\n\nPor favor, peça a conta para fecharmos o valor de hoje!`;
      }
    } else if (statusEnvio === "ANTES") {
      mensagem = `Olá, ${nomeCliente}.\n\nPassando para lembrar que amanhã vence uma nova parcela diária do seu contrato.\n\n💰 Valor da parcela: ${fmt(parcelasOrdenadas[0]?.valor || 0)}\n\nMantenha seus pagamentos em dia para evitar a incidência de taxas por atraso. Obrigado!`;
    } else {
      const parcelaHojeIndex = parcelasOrdenadas.findIndex((p: any) => {
        const pVenc = new Date(p.dataVencimento);
        const pVencPuro = new Date(Date.UTC(pVenc.getUTCFullYear(), pVenc.getUTCMonth(), pVenc.getUTCDate(), 0, 0, 0));
        return isSameDay(pVencPuro, hoje);
      });
      const nParcelaAtual = parcelaHojeIndex !== -1 ? parcelaHojeIndex + 1 : 1;
      const parcelaHoje = parcelasOrdenadas[parcelaHojeIndex] || parcelasOrdenadas[0];

      mensagem = `Diário ;\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence a parcela diária Nº ${nParcelaAtual}/20 do seu contrato.\n\n💰 Valor da parcela de hoje: ${fmt(parcelaHoje?.valor || 0)}\n\n📅 Cronograma completo dos pagamentos:\n\n`;

      for (let i = 1; i <= 20; i++) {
        const p = parcelasOrdenadas[i - 1];
        mensagem += `${i}ª parcela — ${p ? fmtData(p.dataVencimento) : "---"}\n`;
      }
      mensagem += `\nPara realizar o pagamento, solicite a chave PIX ou conta bancária.\n\nApós o pagamento, envie o comprovante.\n\nObrigado.`;
    }
  }

  // ----------------------------------------------------
  // LÓGICA: PLANO SEMANAL (WEEKLY)
  // ----------------------------------------------------
  else if (contrato.periodicity === "WEEKLY" && !turnoNoite) {
    if (statusEnvio === "ATRASADO") {
      const parcelasAtrasadasREAL = parcelasOrdenadas.filter((p: any) => {
        const pVenc = new Date(p.dataVencimento);
        const pVencPuro = new Date(Date.UTC(pVenc.getUTCFullYear(), pVenc.getUTCMonth(), pVenc.getUTCDate(), 0, 0, 0));
        return p.status === "PENDENTE" && pVencPuro < hoje;
      });

      let principalSemanal = 0;
      let jurosSemanal = 0;
      let detalheParcelas = "";

      parcelasAtrasadasREAL.forEach((p: any) => {
        const taxaParcela = Number(p.taxa || 0);
        principalSemanal += Number(p.valor);
        jurosSemanal += taxaParcela;
        detalheParcelas += `• Parcela Nº ${p.numeroParcela} (Vencimento: ${fmtData(p.dataVencimento)}) — Valor: ${fmt(p.valor)} + Multa: ${fmt(taxaParcela)}\n`;
      });

      const totalSemanal = principalSemanal + jurosSemanal;

      mensagem = `⚠️ *COBRANÇA - PARCELA SEMANAL EM ATRASO* ⚠️\n\nOlá, *${nomeCliente}*.\nSua(s) parcela(s) semanal(is) encontra(m)-se em atraso:\n\n${detalheParcelas}\n📊 *Resumo Financeiro:*\n💵 *Subtotal Parcelas:* ${fmt(principalSemanal)}\n📈 *Juros por Atraso:* ${fmt(jurosSemanal)}\n💰 *Total Atualizado:* ${fmt(totalSemanal)}\n\nPor favor, entre em contato imediatamente solicitando a conta para regularizar seu débito.`;
    } else if (statusEnvio === "ANTES") {
      mensagem = `Olá, ${nomeCliente}.\n\nPassando para lembrar que amanhã vence a sua parcela semanal do contrato.\n\n💰 Valor da parcela: ${fmt(parcelasOrdenadas[0]?.valor || 0)}\n\nPor favor, programe-se para realizar o pagamento e evitar taxas adicionais de atraso.`;
    } else {
      const parcelaHoje = parcelasOrdenadas.find((p: any) => {
        const pVenc = new Date(p.dataVencimento);
        const pVencPuro = new Date(Date.UTC(pVenc.getUTCFullYear(), pVenc.getUTCMonth(), pVenc.getUTCDate(), 0, 0, 0));
        return isSameDay(pVencPuro, hoje);
      }) || parcelasOrdenadas[0];

      const data2 = parcelasOrdenadas[1] ? fmtData(parcelasOrdenadas[1].dataVencimento) : "---";
      const data3 = parcelasOrdenadas[2] ? fmtData(parcelasOrdenadas[2].dataVencimento) : "---";
      const data4 = parcelasOrdenadas[3] ? fmtData(parcelasOrdenadas[3].dataVencimento) : "---";

      mensagem = `Semanal ;\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence a parcela semanal do seu contrato no valor de ${fmt(parcelaHoje?.valor || 0)}.\n\nResumo das próximas parcelas:\n\n• 2ª parcela: ${data2}\n• 3ª parcela: ${data3}\n• 4ª parcela: ${data4}\n\nPara pagamento, solicite a chave PIX ou conta.\n\nApós o pagamento, envie o comprovante.\n\nObrigado.`;
    }
  }

  // ----------------------------------------------------
  // LÓGICA: PLANO MENSAL (MONTHLY)
  // ----------------------------------------------------
  else if (contrato.periodicity === "MONTHLY" && !turnoNoite) {
    const principal = Number(contrato.valorPrincipal);
    const percentualJuros = Number(contrato.jurosPercent);
    const jurosCiclo = principal * (percentualJuros / 100);
    const taxaServico = Number(contrato.taxa); // A taxa total acumulada vinda do banco

    const totalMensal = principal + jurosCiclo;

    if (statusEnvio === "ATRASADO") {
      mensagem = `⚠️ *NOTIFICAÇÃO DE ATRASO MENSAL* ⚠️\n\nOlá, *${nomeCliente}*.\nIdentificamos pendências no pagamento do seu plano mensal vencido em ${fmtData(contrato.vencimentoEm)}.\n\n💵 *Valor Principal:* ${fmt(principal)}\n📈 *Juros do Período:* ${fmt(jurosCiclo)}\n🔧 *Taxa Total de Atraso Acumulada:* ${fmt(taxaServico)}\n💰 *Total Geral Atualizado:* ${fmt(totalMensal + taxaServico)}\n\nSolicite a conta para pagamento respondendo a esse chat o quanto antes para evitar novas cobranças diárias.`;
    } else if (statusEnvio === "ANTES") {
      mensagem = `Olá, ${nomeCliente}.\n\nLembrete amigável: Seu contrato na modalidade Mensal vence amanhã (${fmtData(addDays(hoje, 1))}).\n\nOpções para amanhã:\n• Apenas Juros: ${fmt(jurosCiclo)}\n• Quitação Total: ${fmt(totalMensal)}\n\nQualquer dúvida, estamos à disposição.`;
    } else {
      mensagem = `Mensal;\n\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence o seu pagamento mensal referente ao contrato realizado.\n\nValor total para Quitação: ${fmt(totalMensal)}\nJuros do mês: ${fmt(jurosCiclo)}\n\nPara realizar o pagamento, solicite a chave PIX ou conta bancária.\n\nApós o pagamento, envie o comprovante para confirmation.\n\nObrigado.`;
    }
  }

  if (mensagem) {
    try {
      // 🟢 CORRIGIDO: Variável interna alterada de 'message' para 'mensagem' para evitar falhas em runtime
      await WhatsAppService.sendMessage(contrato.userId, contrato.client.telefone, mensagem);
      console.log(`✉️ [Disparo Efetuado] (${statusEnvio}) para ${nomeCliente} [${contrato.periodicity}]`);
      return true;
    } catch (err: any) {
      console.error(`❌ [Cron] Falha ao enviar para ${nomeCliente}:`, err.message);
      return false;
    }
  }
  return false;
}

// --- ENGINE DA ROTINA DE VARREDURA AUTOMÁTICA ---
async function checkAndNotifyContracts(isAfternoonRun: boolean = false) {
  const now = new Date();
  const hoje = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
  
  console.log(`\n🚀 [Cron Notificações] Varredura Iniciada às ${now.toISOString()} | Base Civil: ${hoje.toISOString()}`);

  try {
    const contratos = await prisma.contract.findMany({
      where: {
        status: { in: ["ABERTO", "ATRASADO"] }, // Restrito estritamente a estes dois status permitidos
        user: { plan: "PRO" }
      },
      include: { client: true, installments: true },
    });

    console.log(`📋 Contratos elegíveis ativos carregados: ${contratos.length}`);

    for (const contrato of contratos) {
      if (!contrato.client?.telefone) continue;

      const v = new Date(contrato.vencimentoEm);
      const vencimentoPuro = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), 0, 0, 0));

      let statusEnvio: "ANTES" | "HOJE" | "ATRASADO" | null = null;

      // 🟢 ALTERADO: Agora a régua cobre de forma ILIMITADA os dias em atraso.
      // Enquanto o status for ABERTO ou ATRASADO e o vencimento estiver no passado, ele continua enviando.
      if (isSameDay(hoje, addDays(vencimentoPuro, -1))) {
        statusEnvio = "ANTES";
      } else if (isSameDay(hoje, vencimentoPuro)) {
        statusEnvio = "HOJE";
      } else if (vencimentoPuro < hoje) {
        statusEnvio = "ATRASADO";
      }

      if (!statusEnvio) continue;

      if (isAfternoonRun && contrato.periodicity !== "DAILY") {
        continue;
      }

      if (!isAfternoonRun) {
        if (statusEnvio === "ATRASADO" && contrato.status !== "ATRASADO") {
          await prisma.contract.update({
            where: { id: contrato.id },
            data: { status: "ATRASADO" },
          });
          contrato.status = "ATRASADO";
        }
      }

      const enviou = await processarEnvioMensagem(contrato, statusEnvio, isAfternoonRun);

      if (enviou) {
        const delayRandomico = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
        await sleep(delayRandomico);
      }
    }
  } catch (error) {
    console.error("❌ [Cron Notificações] Erro crítico na rotina de varredura:", error);
  }
}

// --- ATUALIZAÇÃO RECORRENTE DE TAXAS ---
async function runGlobalTaxUpdate() {
  console.log("💰 [Cron Taxas] Aplicando taxas pendentes globais para usuários PRO...");
  try {
    const users = await prisma.user.findMany({
      where: { plan: "PRO" },
      select: { id: true }
    });

    for (const user of users) {
      await ContractService.applyPendingTaxes(user.id);
    }
    console.log(`✅ [Cron Taxas] Taxas atualizadas com sucesso.`);
  } catch (error) {
    console.error("❌ [Cron Taxas] Erro ao atualizar:", error);
  }
}

// --- INICIALIZAÇÃO E AGENDAMENTOS DOS CRONS ---
export const initCronJobs = () => {
  const TIMEZONE = "America/Sao_Paulo";

  // Varredura de 15 em 15 minutos
  cron.schedule("*/15 * * * *", () => {
    checkAndNotifyContracts(false);
  }, {
    timezone: TIMEZONE,
  });

  console.log(`🚀 [PRODUÇÃO] Robô Andrade ativo (Varredura dinâmica baseada em vencimento real ativo).`);
};
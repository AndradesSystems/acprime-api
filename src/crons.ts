import cron from "node-cron";
import { addDays, isSameDay, startOfDay } from "date-fns";
import { prisma } from "./lib/prisma";
import { ContractService } from "./services/contract.service";
import { WhatsAppService } from "./services/whatsapp.service";

// --- CONFIGURAÇÃO DE TESTE ---
const isTestMode = true; // Define como TRUE para ignorar a restrição de turnos fixos e testar tudo a cada 15 min

// --- FUNÇÃO AUXILIAR DE ESPERA (SLEEP) ---
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- FORMATADOR DE MOEDA COM CONVERSÃO DE DECIMAL ---
const fmt = (v: any) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(typeof v === "object" && v.toNumber ? v.toNumber() : Number(v));

// --- FUNÇÃO DE MONTAGEM E DISPARO DA NOTIFICAÇÃO ---
async function processarEnvioMensagem(contrato: any, isAtrasado: boolean, turnoNoite: boolean = false): Promise<boolean> {
  const hoje = startOfDay(new Date());
  const vencimento = startOfDay(new Date(contrato.vencimentoEm));
  
  let mensagem = "";

  // ----------------------------------------------------
  // LÓGICA: PLANO DIÁRIO (DAILY)
  // ----------------------------------------------------
  if (contrato.periodicity === "DAILY") {
    const parcelasPendentes = contrato.installments.filter((i: any) => i.status === "PENDENTE");
    let totalDiario = 0;
    let jurosAcumulado = 0;

    parcelasPendentes.forEach((p: any) => {
      totalDiario += Number(p.valor);
      const pVenc = startOfDay(new Date(p.dataVencimento));
      if (pVenc < hoje) jurosAcumulado += 5;
    });

    const valorFinal = totalDiario + jurosAcumulado;

    if (!turnoNoite) {
      if (isAtrasado) {
        mensagem = `⚠️ *AVISO DE ATRASO - PLANO DIÁRIO* ⚠️\n\nOlá, *${contrato.client.nome}*.\nIdentificamos que sua parcela diária está pendente. Além disso, recalculamos o saldo com a taxa de R$ 5,00 por dia de atraso.\n\n💰 *Total Acumulado:* ${fmt(valorFinal)}\n\nPor favor, responda essa mensagem para solicitar a conta de pagamento.`;
      } else {
        mensagem = `Olá, *${contrato.client.nome}*! Bom dia. 🤖\n\nPassando para lembrar que sua parcela diária de hoje venceu no valor de ${fmt(totalDiario)}.\n\nPor favor, confirme o recebimento e solicite a conta para pagamento abaixo!`;
      }
    } else {
      mensagem = `Olá, *${contrato.client.nome}*! Passando para atualizar seu saldo diário desta noite.\n\nSe você ainda não realizou o pagamento hoje, o valor atualizado em aberto com juros é de *${fmt(valorFinal)}*.\n\nPor favor, peça a conta para fecharmos o valor de hoje!`;
    }
  }

  // ----------------------------------------------------
  // LÓGICA: PLANO SEMANAL (WEEKLY)
  // ----------------------------------------------------
  else if (contrato.periodicity === "WEEKLY" && (!turnoNoite || isTestMode)) {
    const parcelasPendentes = contrato.installments.filter((i: any) => i.status === "PENDENTE");
    let principalSemanal = 0;
    let jurosSemanal = 0;

    parcelasPendentes.forEach((p: any) => {
      principalSemanal += Number(p.valor);
      const pVenc = startOfDay(new Date(p.dataVencimento));
      if (pVenc < hoje) jurosSemanal += 20;
    });

    const totalSemanal = principalSemanal + jurosSemanal;

    if (isAtrasado) {
      const isUltimoDiaAviso = isSameDay(hoje, addDays(vencimento, 3));
      mensagem = `⚠️ *COBRANÇA - PARCELA SEMANAL EM ATRASO* ⚠️\n\nOlá, *${contrato.client.nome}*.\nSua parcela semanal encontra-se em atraso.\n\n💵 *Parcela:* ${fmt(principalSemanal)}\n📈 *Juros por Atraso:* ${fmt(jurosSemanal)}\n💰 *Total Atualizado:* ${fmt(totalSemanal)}\n\n`;
      
      if (isUltimoDiaAviso) {
        mensagem += `📢 *AVISO IMPORTANTE:* Este é o nosso último alerta automático. A partir de amanhã, a sua cobrança será migrada para outras formas de abordagem e o suporte assumirá manualmente.`;
      } else {
        mensagem += `Por favor, entre em contato imediatamente solicitando a conta para regularizar seu débito.`;
      }
    } else {
      mensagem = `Olá, *${contrato.client.nome}*, bom dia! 🤖\n\nHoje vence a sua parcela do empréstimo semanal no valor de *${fmt(principalSemanal)}*.\n\nConfirme o seu pagamento e solicite os dados bancários respondendo esta mensagem!`;
    }
  }

  // ----------------------------------------------------
  // LÓGICA: PLANO MENSAL (MONTHLY)
  // ----------------------------------------------------
  else if (contrato.periodicity === "MONTHLY" && (!turnoNoite || isTestMode)) {
    const principal = Number(contrato.valorPrincipal);
    const percentualJuros = Number(contrato.jurosPercent);
    const jurosCiclo = principal * (percentualJuros / 100);
    const taxaServico = Number(contrato.taxa);
    
    let taxaAtrasoProgressiva = 0;
    if (isAtrasado) {
      let diasEmAtraso = 0;
      for (let i = 1; i <= 5; i++) {
        if (isSameDay(hoje, addDays(vencimento, i))) {
          diasEmAtraso = i;
          break;
        }
      }
      taxaAtrasoProgressiva = diasEmAtraso * 20; 
    }

    const totalMensal = principal + jurosCiclo + taxaServico + taxaAtrasoProgressiva;

    if (isAtrasado) {
      const isUltimoDiaMensal = isSameDay(hoje, addDays(vencimento, 5));
      mensagem = `⚠️ *NOTIFICAÇÃO DE ATRASO MENSAL* ⚠️\n\nOlá, *${contrato.client.nome}*.\nIdentificamos pendências no pagamento do seu plano mensal.\n\n💵 *Valor Principal:* ${fmt(principal)}\n📈 *Juros do Período:* ${fmt(jurosCiclo)}\n🔧 *Taxa Adicional de Atraso:* ${fmt(taxaAtrasoProgressiva)}\n💰 *Total Geral:* ${fmt(totalMensal)}\n\n`;

      if (isUltimoDiaMensal) {
        mensagem += `📢 *AVISO FINAL:* Informamos que este é o prazo limite para a resolução automática. A partir de hoje, a cobrança será realizada por outros meios externos e encaminhada ao setor manual.`;
      } else {
        mensagem += `Solicite a conta para pagamento respondendo a esse chat o quanto antes.`;
      }
    } else {
      mensagem = `Olá, *${contrato.client.nome}*, tudo bem? 🤖\n\nSua dívida mensal vence hoje no valor total de *${fmt(totalMensal)}* (sendo ${fmt(jurosCiclo)} correspondente aos juros contratados).\n\nPor favor, solicite a conta para o pagamento respondendo logo abaixo.`;
    }
  }

  // 🛠️ FIX: Alterado de 'messageText' para 'mensagem' (variável correta)
  if (mensagem) {
    try {
      // Passa o contrato.userId para achar a sessão correta no banco/Baileys
      await WhatsAppService.sendMessage(contrato.userId, contrato.client.telefone, mensagem);
      console.log(`✉️ [Disparo Efetuado] Enviado para ${contrato.client.nome} (${contrato.periodicity})`);
      return true;
    } catch (err: any) {
      console.error(`❌ [Cron] Falha ao enviar para ${contrato.client.nome}:`, err.message);
      return false;
    }
  }

  return false;
}

// --- ENGINE DA ROTINA DE VARREDURA AUTOMÁTICA ---
async function checkAndNotifyContracts(isAfternoonRun: boolean = false) {
  console.log(`🚀 [Cron Notificações] Iniciando varredura de testes (Executando a cada 15 min)...`);
  const hoje = startOfDay(new Date());

  try {
    const contratos = await prisma.contract.findMany({
      where: { status: { in: ["ABERTO", "ATRASADO"] } },
      include: { client: true, installments: true },
    });

    console.log(`📋 Total de contratos encontrados nesta execução de teste: ${contratos.length}`);

    for (const contrato of contratos) {
      const vencimento = startOfDay(new Date(contrato.vencimentoEm));
      let deveNotificar = false;
      let isAtrasado = false;

      if (isAfternoonRun && !isTestMode) {
        if (contrato.periodicity === "DAILY") {
          const janelasDiasDiario = [0, -1, -2, -3];
          deveNotificar = janelasDiasDiario.some((d) => isSameDay(hoje, addDays(vencimento, -d)));
          if (deveNotificar && !isSameDay(hoje, vencimento)) isAtrasado = true;
          
          if (deveNotificar) {
            const enviou = await processarEnvioMensagem(contrato, isAtrasado, true);
            if (enviou) {
              const delayRandomico = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
              await sleep(delayRandomico);
            }
          }
        }
      } else {
        if (contrato.periodicity === "DAILY") {
          const dias = [0, -1, -2, -3];
          deveNotificar = dias.some((d) => isSameDay(hoje, addDays(vencimento, -d)));
          if (deveNotificar && !isSameDay(hoje, vencimento)) isAtrasado = true;
        } 
        else if (contrato.periodicity === "WEEKLY") {
          if (isSameDay(hoje, vencimento)) {
            deveNotificar = true;
          } else {
            const diasAtraso = [-1, -2, -3];
            deveNotificar = diasAtraso.some((d) => isSameDay(hoje, addDays(vencimento, -d)));
            if (deveNotificar) isAtrasado = true;
          }
        } 
        else if (contrato.periodicity === "MONTHLY") {
          if (isSameDay(hoje, vencimento)) {
            deveNotificar = true;
          } else {
            const diasAtraso = [-1, -2, -3, -4, -5];
            deveNotificar = diasAtraso.some((d) => isSameDay(hoje, addDays(vencimento, -d)));
            if (deveNotificar) isAtrasado = true;
          }
        }

        if (deveNotificar) {
          if (isAtrasado && contrato.status !== "ATRASADO") {
            await prisma.contract.update({
              where: { id: contrato.id },
              data: { status: "ATRASADO" },
            });
          }
          
          const enviou = await processarEnvioMensagem(contrato, isAtrasado, false);
          
          if (enviou) {
            const delayRandomico = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
            console.log(`⏳ [Anti-Bloqueio] Aguardando ${delayRandomico / 1000}s para o próximo item...`);
            await sleep(delayRandomico);
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ [Cron Notificações] Erro crítico na rotina de varredura:", error);
  }
}

// --- ATUALIZAÇÃO RECORRENTE DE TAXAS ---
async function runGlobalTaxUpdate() {
  console.log("💰 [Cron Taxas] Aplicando taxas pendentes globais...");
  try {
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      await ContractService.applyPendingTaxes(user.id);
    }
  } catch (error) {
    console.error("❌ [Cron Taxas] Erro ao atualizar:", error);
  }
}

// --- INICIALIZAÇÃO E AGENDAMENTOS DOS CRONS ---
export const initCronJobs = () => {
  const TIMEZONE = "America/Sao_Paulo";

  // =========================================================================
  // COMENTADO: AGENDAMENTOS DE HORÁRIOS FIXOS ANTERIORES (PRODUÇÃO)
  // =========================================================================
  // cron.schedule("0 8 * * *", () => checkAndNotifyContracts(false), { timezone: TIMEZONE });
  // cron.schedule("0 19 * * *", () => checkAndNotifyContracts(true), { timezone: TIMEZONE });
  // =========================================================================

  // 🔥 AGENDAMENTO DE TESTES: Dispara de 15 em 15 minutos de forma contínua
  cron.schedule("*/15 * * * *", () => {
    checkAndNotifyContracts(false);
  }, {
    timezone: TIMEZONE,
  });

  cron.schedule("55 7 * * *", () => runGlobalTaxUpdate(), {
    timezone: TIMEZONE,
  });

  console.log(`🤖 Modo de Testes Ativo: Automações agendadas de 15 em 15 minutos.`);
};
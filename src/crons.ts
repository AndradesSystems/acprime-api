import cron from "node-cron";
import { addDays, isSameDay, startOfDay, format } from "date-fns";
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
async function processarEnvioMensagem(contrato: any, isAtrasado: boolean, turnoNoite: boolean = false): Promise<boolean> {
  const hoje = startOfDay(new Date());

  let mensagem = "";
  const nomeCliente = contrato.client?.nome || "Cliente";

  // Ordena as parcelas cronologicamente para garantir os índices corretos (1ª, 2ª, 3ª...)
  const parcelasOrdenadas = contrato.installments
    ? [...contrato.installments].sort((a: any, b: any) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())
    : [];

  // ----------------------------------------------------
  // LÓGICA: PLANO DIÁRIO (DAILY)
  // ----------------------------------------------------
  if (contrato.periodicity === "DAILY") {
    // Mantém o comportamento de aviso padrão caso esteja atrasado ou no turno da noite
    if (isAtrasado || turnoNoite) {
      const parcelasPendentes = parcelasOrdenadas.filter((i: any) => i.status === "PENDENTE");
      let totalDiario = 0;
      let jurosAcumulado = 0;

      parcelasPendentes.forEach((p: any) => {
        totalDiario += Number(p.valor);
        const pVenc = startOfDay(new Date(p.dataVencimento));
        if (pVenc < hoje) jurosAcumulado += 5;
      });

      const valorFinal = totalDiario + jurosAcumulado;

      if (!turnoNoite) {
        mensagem = `⚠️ *AVISO DE ATRASO - PLANO DIÁRIO* ⚠️\n\nOlá, *${nomeCliente}*.\nIdentificamos que sua parcela diária está pendente. Além disso, recalculamos o saldo com a taxa de R$ 5,00 por dia de atraso.\n\n💰 *Total Acumulado:* ${fmt(valorFinal)}\n\nPor favor, responda essa mensagem para solicitar a conta de pagamento.`;
      } else {
        mensagem = `Olá, *${nomeCliente}*! Passando para atualizar seu saldo diário desta noite.\n\nSe você ainda não realizou o pagamento hoje, o valor atualizado em aberto com juros é de *${fmt(valorFinal)}*.\n\nPor favor, peça a conta para fecharmos o valor de hoje!`;
      }
    } else {
      // Mensagem padrão Diária Solicitada (Fluxo do Dia sem Atraso)
      // Identifica o número da parcela do dia de hoje
      const parcelaHojeIndex = parcelasOrdenadas.findIndex((p: any) => isSameDay(startOfDay(new Date(p.dataVencimento)), hoje));
      const nParcelaAtual = parcelaHojeIndex !== -1 ? parcelaHojeIndex + 1 : 1;

      const parcelaHoje = parcelasOrdenadas[parcelaHojeIndex] || parcelasOrdenadas[0];
      const valorParcelaStr = parcelaHoje ? fmt(parcelaHoje.valor) : fmt(0);

      mensagem = `Diário ;\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence a parcela diária Nº ${nParcelaAtual}/20 do seu contrato.\n\n💰 Valor da parcela de hoje: ${valorParcelaStr}\n\n📅 Cronograma completo dos pagamentos:\n\n`;

      // Monta dinamicamente a lista de datas das 20 parcelas
      for (let i = 1; i <= 20; i++) {
        const p = parcelasOrdenadas[i - 1];
        mensagem += `${i}ª parcela — ${p ? fmtData(p.dataVencimento) : "---"}\n`;
      }

      mensagem += `\nPara realizar o pagamento, solicite a chave PIX ou conta bancária.\n\nApós o pagamento, envie o comprovante.\n\nObrigado.`;
    }
  }

  // ----------------------------------------------------
  // LÓGICA: PLANO SEMANAL (WEEKLY) - Apenas Turno da Manhã
  // ----------------------------------------------------
  else if (contrato.periodicity === "WEEKLY" && !turnoNoite) {
    const parcelasPendentes = parcelasOrdenadas.filter((i: any) => i.status === "PENDENTE");
    let principalSemanal = 0;
    let jurosSemanal = 0;

    parcelasPendentes.forEach((p: any) => {
      principalSemanal += Number(p.valor);
      const pVenc = startOfDay(new Date(p.dataVencimento));
      if (pVenc < hoje) jurosSemanal += 20;
    });

    const totalSemanal = principalSemanal + jurosSemanal;

    if (isAtrasado) {
      const vencimento = startOfDay(new Date(contrato.vencimentoEm));
      const isUltimoDiaAviso = isSameDay(hoje, addDays(vencimento, 3));
      mensagem = `⚠️ *COBRANÇA - PARCELA SEMANAL EM ATRASO* ⚠️\n\nOlá, *${nomeCliente}*.\nSua parcela semanal encontra-se em atraso.\n\n💵 *Parcela:* ${fmt(principalSemanal)}\n📈 *Juros por Atraso:* ${fmt(jurosSemanal)}\n💰 *Total Atualizado:* ${fmt(totalSemanal)}\n\n`;

      if (isUltimoDiaAviso) {
        mensagem += `📢 *AVISO IMPORTANTE:* Este é o nosso último alerta automático. A partir de amanhã, a sua cobrança será migrada para outras formas de abordagem e o suporte assumirá manualmente.`;
      } else {
        mensagem += `Por favor, entre em contato imediatamente solicitando a conta para regularizar seu débito.`;
      }
    } else {
      // Mensagem padrão Semanal Solicitada
      const parcelaHoje = parcelasOrdenadas.find((p: any) => isSameDay(startOfDay(new Date(p.dataVencimento)), hoje)) || parcelasOrdenadas[0];
      const valorParcelaStr = parcelaHoje ? fmt(parcelaHoje.valor) : fmt(0);

      const data2 = parcelasOrdenadas[1] ? fmtData(parcelasOrdenadas[1].dataVencimento) : "---";
      const data3 = parcelasOrdenadas[2] ? fmtData(parcelasOrdenadas[2].dataVencimento) : "---";
      const data4 = parcelasOrdenadas[3] ? fmtData(parcelasOrdenadas[3].dataVencimento) : "---";

      mensagem = `Semanal ;\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence a parcela semanal do seu contrato no valor de ${valorParcelaStr}.\n\nResumo das próximas parcelas:\n\n• 2ª parcela: ${data2}\n• 3ª parcela: ${data3}\n• 4ª parcela: ${data4}\n\nPara pagamento, solicite a chave PIX ou conta.\n\nApós o pagamento, envie o comprovante.\n\nObrigado.`;
    }
  }

  // ----------------------------------------------------
  // LÓGICA: PLANO MENSAL (MONTHLY) - Apenas Turno da Manhã
  // ----------------------------------------------------
  else if (contrato.periodicity === "MONTHLY" && !turnoNoite) {
    const principal = Number(contrato.valorPrincipal);
    const percentualJuros = Number(contrato.jurosPercent);
    const jurosCiclo = principal * (percentualJuros / 100);
    const taxaServico = Number(contrato.taxa);

    let taxaAtrasoProgressiva = 0;
    if (isAtrasado) {
      const vencimento = startOfDay(new Date(contrato.vencimentoEm));
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
      const vencimento = startOfDay(new Date(contrato.vencimentoEm));
      const isUltimoDiaMensal = isSameDay(hoje, addDays(vencimento, 5));
      mensagem = `⚠️ *NOTIFICAÇÃO DE ATRASO MENSAL* ⚠️\n\nOlá, *${nomeCliente}*.\nIdentificamos pendências no pagamento do seu plano mensal.\n\n💵 *Valor Principal:* ${fmt(principal)}\n📈 *Juros do Período:* ${fmt(jurosCiclo)}\n🔧 *Taxa Adicional de Atraso:* ${fmt(taxaAtrasoProgressiva)}\n💰 *Total Geral:* ${fmt(totalMensal)}\n\n`;

      if (isUltimoDiaMensal) {
        mensagem += `📢 *AVISO FINAL:* Informamos que este é o prazo limite para a resolução automática. A partir de hoje, a cobrança será realizada por outros meios externos e encaminhada ao setor manual.`;
      } else {
        mensagem += `Solicite a conta para pagamento respondendo a esse chat o quanto antes.`;
      }
    } else {
      // Mensagem padrão Mensal Solicitada
      mensagem = `Mensal;\n\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence o seu pagamento mensal referente ao contrato realizado.\n\nValor total: ${fmt(totalMensal)}\nJuros/Parcela do mês: ${fmt(jurosCiclo)}\n\nPara realizar o pagamento, solicite a chave PIX ou conta bancária.\n\nApós o pagamento, envie o comprovante para confirmação.\n\nObrigado.`;
    }
  }

  if (mensagem) {
    try {
      await WhatsAppService.sendMessage(contrato.userId, contrato.client.telefone, mensagem);
      console.log(`✉️ [Disparo Efetuado] Enviado para ${nomeCliente} (${contrato.periodicity})`);
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
  console.log(`🚀 [Cron Notificações] Iniciando varredura oficial de produção para usuários PRO...`);
  const hoje = startOfDay(new Date());

  try {
    const contratos = await prisma.contract.findMany({
      where: {
        status: { in: ["ABERTO", "ATRASADO"] },
        user: {
          plan: "PRO"
        }
      },
      include: { client: true, installments: true },
    });

    console.log(`📋 Total de contratos de usuários PRO mapeados: ${contratos.length}`);

    for (const contrato of contratos) {
      if (!contrato.client?.telefone) {
        console.log(`⏩ [Ignorado] Cliente ${contrato.client?.nome || 'Sem Nome'} sem telefone válido.`);
        continue;
      }

      const vencimento = startOfDay(new Date(contrato.vencimentoEm));
      let deveNotificar = false;
      let isAtrasado = false;

      if (isAfternoonRun) {
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
        // 1. Lógica Diária (Hoje + até 3 dias de atraso)
        if (contrato.periodicity === "DAILY") {
          const dias = [0, -1, -2, -3];
          deveNotificar = dias.some((d) => isSameDay(hoje, addDays(vencimento, -d)));
          if (deveNotificar && !isSameDay(hoje, vencimento)) isAtrasado = true;
        }
        // 2. Lógica Semanal (Hoje + até 3 dias de atraso)
        else if (contrato.periodicity === "WEEKLY") {
          if (isSameDay(hoje, vencimento)) {
            deveNotificar = true;
          } else {
            const diasAtraso = [-1, -2, -3];
            deveNotificar = diasAtraso.some((d) => isSameDay(hoje, addDays(vencimento, -d)));
            if (deveNotificar) isAtrasado = true;
          }
        }
        // 3. Lógica Mensal (Hoje + até 5 dias de atraso)
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
            console.log(`⏳ [Anti-Bloqueio] Aguardando ${delayRandomico / 1000}s para o próximo item da fila...`);
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
  console.log("💰 [Cron Taxas] Aplicando taxas pendentes globais para usuários PRO...");
  try {
    const users = await prisma.user.findMany({
      where: { plan: "PRO" },
      select: { id: true }
    });

    for (const user of users) {
      await ContractService.applyPendingTaxes(user.id);
    }
    console.log(`✅ [Cron Taxas] Taxas updated com sucesso para ${users.length} usuários PRO.`);
  } catch (error) {
    console.error("❌ [Cron Taxas] Erro ao atualizar:", error);
  }
}

// --- INICIALIZAÇÃO E AGENDAMENTOS DOS CRONS ---
export const initCronJobs = () => {
  // Define o fuso horário padrão para garantir que os gatilhos sigam o horário de Brasília
  const TIMEZONE = "America/Sao_Paulo";

  /**
   * 🕒 NOVA ROTINA: Executa a cada 15 minutos (ex: 08:00, 08:15, 08:30...)
   * Substitui os disparos fixos das 08h e 19h por uma checagem contínua.
   * O parâmetro 'false' indica que é a execução padrão/matinal para os planos.
   */
  cron.schedule("*/15 * * * *", () => {
    checkAndNotifyContracts(false);
  }, {
    timezone: TIMEZONE,
  });

  /**
   * 🕒 REFORÇO DA NOITE: Mantido fixo às 19:00h todos os dias
   * O parâmetro 'true' ativa o comportamento exclusivo de reforço noturno para planos DIÁRIOS.
   */
  cron.schedule("0 19 * * *", () => {
    checkAndNotifyContracts(true);
  }, {
    timezone: TIMEZONE,
  });

  /**
   * 💰 ENGINE DE TAXAS: Executa diariamente às 07:55h
   * Roda exatamente 5 minutos antes do horário que costumava ser o grande pico da manhã,
   * aplicando juros e atualizando os saldos dos usuários PRO no banco de dados.
   */
  cron.schedule("55 7 * * *", () => {
    runGlobalTaxUpdate();
  }, {
    timezone: TIMEZONE,
  });

  // Log de inicialização do sistema no terminal
  console.log(`🚀 [PRODUÇÃO] Robô Andrade ativo (Verificação a cada 15m e Reforço às 19h) com filtros PRO habilitados.`);
};
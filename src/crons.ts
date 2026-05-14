import cron from "node-cron";
import { addDays, isSameDay, startOfDay } from "date-fns";
import axios from "axios";

// 👇 IMPORTANTE: Importe o serviço de contratos aqui
import { ContractService } from "./services/contract.service";
import { prisma } from "./lib/prisma";


const EVOLUTION_API_URL = process.env.EVOLUTION_URL || "https://localhost:8080";
const INSTANCE_NAME = "AndradeBOT";
const API_KEY = "admin123";

// --- FUNÇÃO CORE DE DISPARO (NOTIFICAÇÕES) ---
async function dispararNotificacao(contrato: any, isAtrasado: boolean = false) {
  let cleanNumber = contrato.client.telefone.replace(/\D/g, "");
  if (!cleanNumber.startsWith("55")) cleanNumber = `55${cleanNumber}`;

  const fmt = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  // --- CÁLCULO DE PARCELAS ---
  const parcelasPendentes = contrato.installments.filter(
    (i: any) => i.status === "PENDENTE",
  );

  let resumoParcelas = "";
  let somaPrincipalParcelas = 0;
  let somaTaxasParcelas = 0;

  parcelasPendentes.forEach((p: any) => {
    const v = Number(p.valor);
    const t = Number(p.taxa);
    somaPrincipalParcelas += v;
    somaTaxasParcelas += t;

    const dataVenc = new Date(p.dataVencimento).toLocaleDateString("pt-BR");
    resumoParcelas += `• Parcela ${p.numeroParcela} (${dataVenc}): ${fmt(v)}${
      t > 0 ? ` + Taxa: ${fmt(t)}` : ""
    }\n`;
  });

  // --- CÁLCULO TOTAL ---
  let principal = Number(contrato.valorPrincipal);
  let total = 0;
  let jurosCalculado = 0;
  const percentualJuros = Number(contrato.jurosPercent);

  if (contrato.periodicity === "MONTHLY") {
    jurosCalculado = principal * (percentualJuros / 100);
    const taxaCiclo = Number(contrato.taxa);
    total = principal + jurosCalculado + taxaCiclo;
  } else {
    total = somaPrincipalParcelas + somaTaxasParcelas;
  }

  const dataVencimentoGeral = new Date(
    contrato.vencimentoEm,
  ).toLocaleDateString("pt-BR");

  // --- MONTAGEM DA MENSAGEM ---
  let mensagem = "";

  if (isAtrasado) {
    mensagem = `⚠️ *AVISO DE ATRASO* ⚠️\n\nOlá, *${contrato.client.nome}*! Identificamos pendências em seu cadastro que ainda não constam como baixadas.\n\n`;
  } else {
    mensagem = `Olá, *${contrato.client.nome}*! Aqui é o *Andrade*, seu assistente virtual. 🤖\n\nEstou passando para lembrar dos seus valores em aberto:\n\n`;
  }

  if (contrato.periodicity === "MONTHLY") {
    mensagem +=
      `💵 *Valor Principal:* ${fmt(principal)}\n` +
      `📈 *Juros do Período (${percentualJuros}%):* ${fmt(jurosCalculado)}\n`;
    if (Number(contrato.taxa) > 0) {
      mensagem += `➕ *Taxa de Serviço:* ${fmt(Number(contrato.taxa))}\n`;
    }
  } else {
    mensagem += `📝 *Resumo das Parcelas Pendentes:*\n${resumoParcelas}\n`;
  }

  mensagem +=
    `💰 *Total Geral:* ${fmt(total)}\n` +
    `📅 *Data de Referência:* ${dataVencimentoGeral}\n\n` +
    `📢 *POR FAVOR, CONFIRME O RECEBIMENTO DESTA MENSAGEM.* 👋\n\n` +
    `Qualquer dúvida, estou à disposição!`;

  const payload = {
    number: cleanNumber,
    delay: 1200,
    text: mensagem,
  };

  try {
    await axios.post(
      `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`,
      payload,
      {
        headers: { apikey: API_KEY, "Content-Type": "application/json" },
      },
    );
    console.log(
      `✅ [Andrade] Notificação enviada para ${contrato.client.nome} (${
        isAtrasado ? "Atraso" : "Lembrete"
      })`,
    );
  } catch (error: any) {
    console.error(
      `❌ [Andrade] Erro no envio:`,
      error.response?.data || error.message,
    );
  }
}

// --- FUNÇÃO PARA O DISPARO MANUAL ---
export const dispararNotificacaoManual = async (contractId: string) => {
  const contrato = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { client: true, installments: true },
  });
  if (!contrato) throw new Error("Contrato não encontrado");
  return await dispararNotificacao(contrato);
};

// --- FUNÇÃO DA AUTOMAÇÃO DE NOTIFICAÇÕES ---
async function checkAndNotifyContracts(isAfternoonRun: boolean = false) {
  console.log(
    `🚀 [Cron Notificações] Verificação iniciada (${
      isAfternoonRun ? "Turno 17h - APENAS DIÁRIOS" : "Turno 10h - TODOS"
    })`,
  );
  const hoje = startOfDay(new Date());

  try {
    const contratos = await prisma.contract.findMany({
      where: { status: { in: ["ABERTO", "ATRASADO"] } },
      include: { client: true, installments: true },
    });

    for (const contrato of contratos) {
      const vencimento = startOfDay(new Date(contrato.vencimentoEm));
      let deveNotificar = false;
      let isAtrasado = false;

      // --- LOGICA DE FILTRO ---
      if (isAfternoonRun) {
        if (contrato.periodicity === "DAILY" && isSameDay(hoje, vencimento)) {
          deveNotificar = true;
        }
      } else {
        if (contrato.periodicity === "DAILY") {
          const dias = [0, -1, -2, -3];
          deveNotificar = dias.some((d) =>
            isSameDay(hoje, addDays(vencimento, -d)),
          );
          if (deveNotificar && !isSameDay(hoje, vencimento)) isAtrasado = true;
        } else if (contrato.periodicity === "WEEKLY") {
          const diasLembrete = [3, 1, 0];
          const diasAtraso = [-1, -2, -3, -4];
          if (
            diasLembrete.some((d) => isSameDay(hoje, addDays(vencimento, -d)))
          ) {
            deveNotificar = true;
          } else if (
            diasAtraso.some((d) => isSameDay(hoje, addDays(vencimento, -d)))
          ) {
            deveNotificar = true;
            isAtrasado = true;
          }
        } else if (contrato.periodicity === "MONTHLY") {
          const diasLembrete = [5, 1, 0];
          const diasAtraso = [-1, -2, -3, -4, -5];
          if (
            diasLembrete.some((d) => isSameDay(hoje, addDays(vencimento, -d)))
          ) {
            deveNotificar = true;
          } else if (
            diasAtraso.some((d) => isSameDay(hoje, addDays(vencimento, -d)))
          ) {
            deveNotificar = true;
            isAtrasado = true;
          }
        }
      }

      if (deveNotificar) {
        if (isAtrasado && contrato.status !== "ATRASADO") {
          await prisma.contract.update({
            where: { id: contrato.id },
            data: { status: "ATRASADO" },
          });
        }
        await dispararNotificacao(contrato, isAtrasado);
      }
    }
  } catch (error) {
    console.error("❌ [Cron Notificações] Erro na rotina:", error);
  }
}

// --- 👇 NOVA FUNÇÃO: ATUALIZAÇÃO DE TAXAS (GLOBAL) ---
async function runGlobalTaxUpdate() {
  console.log("💰 [Cron Taxas] Iniciando atualização global de taxas...");
  try {
    // Busca todos os usuários (Admin/Donos de plataforma)
    const users = await prisma.user.findMany({
      select: { id: true },
    });

    for (const user of users) {
      // Chama o service otimizado que refatoramos
      await ContractService.applyPendingTaxes(user.id);
    }
    console.log("✅ [Cron Taxas] Taxas calculadas e atualizadas com sucesso.");
  } catch (error) {
    console.error("❌ [Cron Taxas] Erro ao atualizar taxas:", error);
  }
}

async function clearTestClientData() {
  const targetClientId = "cmkipxx1w0001q7waw6ltyz58"; // ID do Eduardo Ramos (Duplicado)

  console.log(`🗑️ Iniciando limpeza para o cliente: ${targetClientId}`);

  try {
    // ✅ CORREÇÃO: Usando a sintaxe de função (Interactive Transaction)
    // Isso evita o erro "Type void is not assignable to PrismaPromise"
    await prisma.$transaction(async (tx) => {
      
      // 1. Apagar Parcelas (usamos 'tx' ao invés de 'prisma' aqui dentro)
      const parcelas = await tx.contractInstallment.deleteMany({
        where: { contract: { clientId: targetClientId } }
      });
      console.log(`   - Parcelas apagadas: ${parcelas.count}`);

      // 2. Apagar Histórico de Pagamentos
      const pagamentos = await tx.paymentHistory.deleteMany({
        where: { contract: { clientId: targetClientId } }
      });
      console.log(`   - Pagamentos apagados: ${pagamentos.count}`);

      // 3. Apagar Contratos
      const contratos = await tx.contract.deleteMany({
        where: { clientId: targetClientId }
      });
      console.log(`   - Contratos apagados: ${contratos.count}`);
    });

    console.log("✅ Limpeza concluída com sucesso!");

  } catch (error) {
    console.error("❌ Erro ao apagar:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// --- INICIALIZAÇÃO DOS CRONS ---
export const initCronJobs = () => {
  const TIMEZONE = "America/Sao_Paulo";

  // 1. Notificações do Andrade (MANTIDO)
  cron.schedule("0 10 * * *", () => checkAndNotifyContracts(false), {
    timezone: TIMEZONE,
  });

  cron.schedule("0 17 * * *", () => checkAndNotifyContracts(true), {
    timezone: TIMEZONE,
  });

 
  // 2. Atualização de Taxas (NOVO) - 10h e 18h
  // DICA: Coloquei 09:55 para garantir que quando a notificação de 10:00 sair,
  // a taxa já esteja atualizada. Se quiser exatamente as 10, mude para "0 10 * * *"
  cron.schedule("0 10 * * *", () => runGlobalTaxUpdate(), {
    timezone: TIMEZONE,
  });

  cron.schedule("0 18 * * *", () => runGlobalTaxUpdate(), {
    timezone: TIMEZONE,
  });

  console.log(`🤖 Robô Andrade e Sistema de Taxas configurados.`);
};

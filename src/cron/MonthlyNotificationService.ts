import { addDays } from "date-fns";
import { prisma } from "../lib/prisma";
import { WhatsAppService } from "../services/whatsapp.service";
import { type CompleteContract, fmtCurrency, fmtDate, getTodayMidnightUTC, parseDBDateUTC, isSameDayUTC, differenceInDaysUTC, sleep } from "./utils";

export class MonthlyNotificationService {
  public static async execute(): Promise<void> {
    const hoje = getTodayMidnightUTC();
    console.log(`\n🏢 [Cron Mensal] Iniciado | Base UTC: ${hoje.toISOString()}`);

    try {
      const contratos = await prisma.contract.findMany({
        where: {
          periodicity: "MONTHLY",
          status: { in: ["ABERTO", "ATRASADO"] },
          user: { plan: "PRO" }
        },
        include: { client: true, installments: true },
      });

      for (const contrato of contratos as unknown as CompleteContract[]) {
        if (!contrato.client?.telefone || !contrato.vencimentoEm) continue;

        const vencimentoContrato = parseDBDateUTC(contrato.vencimentoEm);
        const nomeCliente = contrato.client.nome || "Cliente";
        const mensagensParaEnviar: string[] = [];

        const principal = Number(contrato.valorPrincipal || 0);
        const percentualJuros = Number(contrato.jurosPercent || 0);
        const jurosCiclo = principal * (percentualJuros / 100);
        const taxaServico = Number(contrato.taxa || 0);
        const totalMensal = principal + jurosCiclo;

        // --- FLUXO 1: NOTIFICAÇÃO DE ATRASO MENSAL (De 1 a 5 dias de atraso) ---
        // Corrigido: Agora aceita contratos que ainda estão com status "ABERTO" mas já venceram
        if (hoje > vencimentoContrato) {
          const diasAtraso = differenceInDaysUTC(hoje, vencimentoContrato);

          if (diasAtraso >= 1 && diasAtraso <= 5) {
            const msgAtraso = `⚠️ *NOTIFICAÇÃO DE ATRASO MENSAL* ⚠️\n\nOlá, *${nomeCliente}*.\nIdentificamos pendências no seu plano mensal vencido em ${fmtDate(contrato.vencimentoEm)} (Notificação ${diasAtraso}/5):\n\n💵 *Valor Principal:* ${fmtCurrency(principal)}\n📈 *Juros do Período:* ${fmtCurrency(jurosCiclo)}\n🔧 *Taxa de Atraso Acumulada:* ${fmtCurrency(taxaServico)}\n💰 *Total Geral Atualizado:* ${fmtCurrency(totalMensal + taxaServico)}\n\nSolicite a conta para pagamento respondendo a esse chat o quanto antes para evitar novas cobranças.`;
            
            mensagensParaEnviar.push(msgAtraso);

            // Atualiza o status do contrato para ATRASADO caso ele ainda estivesse ABERTO
            if (contrato.status !== "ATRASADO") {
              await prisma.contract.update({ 
                where: { id: contrato.id }, 
                data: { status: "ATRASADO" } 
              });
              console.log(`🔄 [Mensal] Contrato ${contrato.id} atualizado para status: ATRASADO`);
            }
          }
        }

        // --- FLUXO 2: VENCIMENTO HOJE ---
        if (isSameDayUTC(hoje, vencimentoContrato)) {
          const msgHoje = `Mensal;\n\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence o seu pagamento mensal referente ao contrato realizado.\n\nValor total para Quitação: ${fmtCurrency(totalMensal)}\nJuros do mês: ${fmtCurrency(jurosCiclo)}\n\nPara realizar o pagamento, solicite a chave PIX ou conta bancária.\n\nApós o pagamento, envie o comprovante para confirmação. Obrigado.`;
          
          mensagensParaEnviar.push(msgHoje);
        }

        // --- FLUXO 3: LEMBRETE ANTES (1 dia antes do vencimento) ---
        const umDiaAntes = addDays(vencimentoContrato, -1);
        if (isSameDayUTC(hoje, umDiaAntes)) {
          const msgLembrete = `Olá, ${nomeCliente}.\n\nLembrete amigável: Seu contrato na modalidade Mensal vence amanhã (${fmtDate(vencimentoContrato)}).\n\nOpções para amanhã:\n• Apenas Renovar Juros: ${fmtCurrency(jurosCiclo)}\n• Quitação Total do Plano: ${fmtCurrency(totalMensal)}\n\nQualquer dúvida, estamos à disposição.`;
          
          mensagensParaEnviar.push(msgLembrete);
        }

        // --- DISPARO SEQUENCIAL DAS MENSAGENS GERADAS ---
        for (const mensagem of mensagensParaEnviar) {
          await WhatsAppService.sendMessage(contrato.userId, contrato.client.telefone, mensagem);
          console.log(`✉️ [Mensal] Mensagem enviada para ${nomeCliente}`);
          await sleep(Math.floor(Math.random() * 10000) + 5000);
        }
      }
    } catch (error: any) {
      console.error("❌ [Cron Mensal] Erro na rotina:", error.message);
    }
  }
}
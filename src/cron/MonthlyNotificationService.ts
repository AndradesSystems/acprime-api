import { isSameDay, addDays, differenceInDays } from "date-fns";
import { prisma } from "../lib/prisma";
import { WhatsAppService } from "../services/whatsapp.service";
import { type CompleteContract, fmtCurrency, fmtDate, getMidnightUTC, sleep } from "./utils";

export class MonthlyNotificationService {
  public static async execute(): Promise<void> {
    const hoje = getMidnightUTC(new Date());
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

        const vencimentoContrato = getMidnightUTC(contrato.vencimentoEm);
        let mensagem = "";
        const nomeCliente = contrato.client.nome || "Cliente";

        // Converte com segurança os Decimals do Prisma para números lidos pelo JS
        const principal = Number(contrato.valorPrincipal || 0);
        const percentualJuros = Number(contrato.jurosPercent || 0);
        const jurosCiclo = principal * (percentualJuros / 100);
        const taxaServico = Number(contrato.taxa || 0);
        const totalMensal = principal + jurosCiclo;

        // 1. LIMITADOR DE ATRASO MENSAL (Até 5 dias máximos)
        if (hoje > vencimentoContrato && contrato.status === "ATRASADO") {
          const diasAtraso = differenceInDays(hoje, vencimentoContrato);

          if (diasAtraso <= 5) {
            mensagem = `⚠️ *NOTIFICAÇÃO DE ATRASO MENSAL* ⚠️\n\nOlá, *${nomeCliente}*.\nIdentificamos pendências no seu plano mensal vencido em ${fmtDate(contrato.vencimentoEm)} (Notificação ${diasAtraso}/5):\n\n💵 *Valor Principal:* ${fmtCurrency(principal)}\n📈 *Juros do Período:* ${fmtCurrency(jurosCiclo)}\n🔧 *Taxa de Atraso Acumulada:* ${fmtCurrency(taxaServico)}\n💰 *Total Geral Atualizado:* ${fmtCurrency(totalMensal + taxaServico)}\n\nSolicite a conta para pagamento respondendo a esse chat o quanto antes para evitar novas cobranças.`;
          }

        // 2. VENCIMENTO (HOJE)
        } else if (isSameDay(hoje, vencimentoContrato)) {
          mensagem = `Mensal;\n\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence o seu pagamento mensal referente ao contrato realizado.\n\nValor total para Quitação: ${fmtCurrency(totalMensal)}\nJuros do mês: ${fmtCurrency(jurosCiclo)}\n\nPara realizar o pagamento, solicite a chave PIX ou conta bancária.\n\nApós o pagamento, envie o comprovante para confirmação. Obrigado.`;

        // 3. LEMBRETE ANTES (1 dia antes)
        } else if (isSameDay(hoje, addDays(vencimentoContrato, -1))) {
          mensagem = `Olá, ${nomeCliente}.\n\nLembrete amigável: Seu contrato na modalidade Mensal vence amanhã (${fmtDate(vencimentoContrato)}).\n\nOpções para amanhã:\n• Apenas Renovar Juros: ${fmtCurrency(jurosCiclo)}\n• Quitação Total do Plano: ${fmtCurrency(totalMensal)}\n\nQualquer dúvida, estamos à disposição.`;
        }

        if (mensagem) {
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
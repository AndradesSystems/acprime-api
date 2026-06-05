import { addDays } from "date-fns";
import { prisma } from "../lib/prisma";
import { WhatsAppService } from "../services/whatsapp.service";
import { type CompleteContract, fmtCurrency, fmtDate, getTodayMidnightUTC, parseDBDateUTC, isSameDayUTC, differenceInDaysUTC, sleep } from "./utils";

export class WeeklyNotificationService {
  public static async execute(): Promise<void> {
    const hoje = getTodayMidnightUTC();
    console.log(`\n📅 [Cron Semanal] Iniciado | Base UTC: ${hoje.toISOString()}`);

    try {
      const contratos = await prisma.contract.findMany({
        where: {
          periodicity: "WEEKLY",
          status: { in: ["ABERTO", "ATRASADO"] },
          user: { plan: "PRO" }
        },
        include: { client: true, installments: true },
      });

      for (const contrato of contratos as unknown as CompleteContract[]) {
        if (!contrato.client?.telefone) continue;

        const parcelasOrdenadas = [...contrato.installments].sort(
          (a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime()
        );

        const nomeCliente = contrato.client.nome || "Cliente";
        const mensagensParaEnviar: string[] = [];

        const parcelasAtrasadas = parcelasOrdenadas.filter(p => {
          const pVenc = parseDBDateUTC(p.dataVencimento);
          return p.status === "PENDENTE" && pVenc < hoje;
        });

        // --- FLUXO 1: COBRANÇA EM ATRASO (Dispara de 1 a 5 dias de atraso) ---
        if (parcelasAtrasadas.length > 0) {
          const maisAntigaAtrasada = parcelasAtrasadas[0];

          if (maisAntigaAtrasada && maisAntigaAtrasada.dataVencimento) {
            const diasAtraso = differenceInDaysUTC(hoje, maisAntigaAtrasada.dataVencimento);

            if (diasAtraso >= 1 && diasAtraso <= 5) {
              let principalSemanal = 0;
              let jurosSemanal = 0;
              let detalheParcelas = "";

              parcelasAtrasadas.forEach((p) => {
                const taxa = Number(p.taxa || 0);
                principalSemanal += Number(p.valor);
                jurosSemanal += taxa;
                detalheParcelas += `• Parcela Nº ${p.numeroParcela} (Vencimento: ${fmtDate(p.dataVencimento)}) — Valor: ${fmtCurrency(p.valor)} + Multa: ${fmtCurrency(taxa)}\n`;
              });

              const totalSemanal = principalSemanal + jurosSemanal;

              const msgAtraso = `⚠️ *COBRANÇA - PARCELA SEMANAL EM ATRASO* ⚠️\n\nOlá, *${nomeCliente}*.\nSua(s) parcela(s) semanal(is) encontra(m)-se em atraso (Notificação ${diasAtraso}/5):\n\n${detalheParcelas}\n📊 *Resumo Financeiro:*\n💵 *Subtotal Parcelas:* ${fmtCurrency(principalSemanal)}\n📈 *Juros por Atraso:* ${fmtCurrency(jurosSemanal)}\n💰 *Total Atualizado:* ${fmtCurrency(totalSemanal)}\n\nPor favor, entre em contato imediatamente solicitando a conta para regularizar seu débito.`;
              
              mensagensParaEnviar.push(msgAtraso);

              if (contrato.status !== "ATRASADO") {
                await prisma.contract.update({ where: { id: contrato.id }, data: { status: "ATRASADO" } });
              }
            }
          }
        }

        // --- FLUXO 2: MENSAGENS EM DIA (VENCE HOJE OU LEMBRETE AMANHÃ) ---
        const parcelaHoje = parcelasOrdenadas.find(p => isSameDayUTC(p.dataVencimento, hoje));
        const amanha = addDays(hoje, 1);
        const parcelaAmanha = parcelasOrdenadas.find(p => isSameDayUTC(p.dataVencimento, amanha));

        // Caso: Vence Hoje
        if (parcelaHoje && parcelaHoje.status === "PENDENTE") {
          const prox1 = parcelasOrdenadas[1] ? fmtDate(parcelasOrdenadas[1].dataVencimento) : "---";
          const prox2 = parcelasOrdenadas[2] ? fmtDate(parcelasOrdenadas[2].dataVencimento) : "---";

          const msgHoje = `Semanal;\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence a parcela semanal do seu contrato no valor de ${fmtCurrency(parcelaHoje.valor)}.\n\nResumo das próximas parcelas:\n• Próxima parcela: ${prox1}\n• Segunda parcela: ${prox2}\n\nPara pagamento, solicite a chave PIX ou conta. Após o pagamento, envie o comprovante. Obrigado.`;
          
          mensagensParaEnviar.push(msgHoje);
        
        // Caso: Lembrete de Vencimento Amanhã
        } else if (parcelaAmanha && parcelaAmanha.status === "PENDENTE") {
          const msgAmanha = `Olá, ${nomeCliente}.\n\nPassando para lembrar que amanhã vence a sua parcela semanal do contrato.\n\n💰 Valor da parcela: ${fmtCurrency(parcelaAmanha.valor)}\n\nPor favor, programe-se para realizar o pagamento e evitar taxas adicionais de atraso.`;
          
          mensagensParaEnviar.push(msgAmanha);
        }

        // --- DISPARO SEQUENCIAL DAS MENSAGENS ---
        for (const mensagem of mensagensParaEnviar) {
          await WhatsAppService.sendMessage(contrato.userId, contrato.client.telefone, mensagem);
          console.log(`✉️ [Semanal] Mensagem enviada para ${nomeCliente}`);
          await sleep(Math.floor(Math.random() * 10000) + 5000);
        }
      }
    } catch (err: any) {
      console.error("❌ [Cron Semanal] Erro na rotina:", err.message);
    }
  }
}
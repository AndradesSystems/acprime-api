import { isSameDay } from "date-fns";
import { prisma } from "../lib/prisma"; 
import { WhatsAppService } from "../services/whatsapp.service"; 
import { type CompleteContract, fmtCurrency, fmtDate, getMidnightUTC, sleep } from "./utils";

export class DailyNotificationService {
  public static async execute(): Promise<void> {
    const hoje = getMidnightUTC(new Date());
    console.log(`\n🌞 [Cron Diário] Iniciado | Base UTC: ${hoje.toISOString()}`);

    try {
      const contratos = await prisma.contract.findMany({
        where: {
          periodicity: "DAILY",
          status: { in: ["ABERTO", "ATRASADO"] },
          user: { plan: "PRO" }
        },
        include: { client: true, installments: true },
      });

      for (const contrato of contratos as unknown as CompleteContract[]) {
        if (!contrato.client?.telefone) continue;

        // Ordena as parcelas pelas datas de vencimento
        const parcelasOrdenadas = [...contrato.installments].sort(
          (a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime()
        );

        // Identifica se há uma parcela que vence HOJE
        const parcelaHoje = parcelasOrdenadas.find(p => isSameDay(getMidnightUTC(p.dataVencimento), hoje));

        // Filtra parcelas ATRASADAS utilizando o enum correto: PENDENTE
        const parcelasAtrasadas = parcelasOrdenadas.filter(p => {
          const pVenc = getMidnightUTC(p.dataVencimento);
          return p.status === "PENDENTE" && pVenc < hoje;
        });

        let mensagem = "";
        const nomeCliente = contrato.client.nome || "Cliente";

        // CASO A: Se houver parcelas atrasadas, acumula com a de hoje (se houver)
        if (parcelasAtrasadas.length > 0) {
          let totalDiario = 0;
          let jurosAcumulado = 0;
          let detalheParcelas = "";

          parcelasAtrasadas.forEach((p) => {
            const taxa = Number(p.taxa || 0);
            totalDiario += Number(p.valor);
            jurosAcumulado += taxa;
            detalheParcelas += `• Parcela Nº ${p.numeroParcela} (Venceu em: ${fmtDate(p.dataVencimento)}) — Valor: ${fmtCurrency(p.valor)} + Multa: ${fmtCurrency(taxa)}\n`;
          });

          // Se a de hoje também estiver pendente, cobra junto
          if (parcelaHoje && parcelaHoje.status === "PENDENTE") {
            totalDiario += Number(parcelaHoje.valor);
            detalheParcelas += `• Parcela Nº ${parcelaHoje.numeroParcela} (Vence HOJE: ${fmtDate(parcelaHoje.dataVencimento)}) — Valor: ${fmtCurrency(parcelaHoje.valor)}\n`;
          }

          const valorFinal = totalDiario + jurosAcumulado;

          mensagem = `⚠️ *AVISO DE COBRANÇA - PLANO DIÁRIO* ⚠️\n\nOlá, *${nomeCliente}*.\nIdentificamos pendências acumuladas no seu contrato diário:\n\n${detalheParcelas}\n📊 *Resumo Financeiro:*\n• Subtotal das parcelas: ${fmtCurrency(totalDiario)}\n• Total de multas: ${fmtCurrency(jurosAcumulado)}\n💰 *Total Geral Atualizado:* ${fmtCurrency(valorFinal)}\n\nPor favor, responda essa mensagem para solicitar a conta de pagamento e regularizar sua situação o quanto antes.`;

          if (contrato.status !== "ATRASADO") {
            await prisma.contract.update({ where: { id: contrato.id }, data: { status: "ATRASADO" } });
          }

        // CASO B: Não há atrasos, apenas a parcela de HOJE normal
        } else if (parcelaHoje && parcelaHoje.status === "PENDENTE") {
          const nParcelaAtual = parcelaHoje.numeroParcela || 1;

          mensagem = `Diário;\nBom dia, ${nomeCliente}, tudo bem?\n\nHoje vence a parcela diária Nº ${nParcelaAtual} do seu contrato.\n\n💰 Valor da parcela de hoje: ${fmtCurrency(parcelaHoje.valor)}\n\n📅 Cronograma das próximas parcelas:\n`;

          const indexHoje = parcelasOrdenadas.indexOf(parcelaHoje);
          const proximas = parcelasOrdenadas.slice(indexHoje, indexHoje + 5);
          proximas.forEach((p) => {
            mensagem += `${p.numeroParcela}ª parcela — ${fmtDate(p.dataVencimento)}\n`;
          });

          mensagem += `\nPara realizar o pagamento, solicite a chave PIX ou conta bancária.\n\nApós o pagamento, envie o comprovante. Obrigado.`;
        }

        if (mensagem) {
          await WhatsAppService.sendMessage(contrato.userId, contrato.client.telefone, mensagem);
          console.log(`✉️ [Diário] Mensagem enviada para ${nomeCliente}`);
          await sleep(Math.floor(Math.random() * 10000) + 5000);
        }
      }
    } catch (err: any) {
      console.error("❌ [Cron Diário] Erro na rotina:", err.message);
    }
  }
}
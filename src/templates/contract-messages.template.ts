export interface MessageData {
  nomeCliente: string;
  idContrato: string;
  valorEmprestado: string;
  taxaJuros: string;
  valorTotal: string;
  valorJuros?: string;
  valorParcela?: string;
  dataVencimento: string;
  qtdParcelas?: string; // Adicionado para suportar a modalidade dinâmica do PARCELADO
}

// Tipando o objeto explicitamente com Record para aceitar qualquer chave vinda do ContractPeriodicity
export const ContractTemplates: Record<string, (d: MessageData) => string> = {
  PARCELADO: (d: MessageData) => `Olá, ${d.nomeCliente}.

Seu contrato foi criado com sucesso em nosso sistema.

📄 Informações do contrato:

• Número do contrato: # ${d.idContrato}
• Modalidade: Parcelado Fixo
• Valor emprestado: ${d.valorEmprestado}
• Percentual de juros total: ${d.taxaJuros}%
• Valor total da operação: ${d.valorTotal}

💰 Forma de pagamento:

• Quantidade de parcelas: ${d.qtdParcelas || "---"} parcelas
• Valor da parcela: ${d.valorParcela || "---"}
• Data do primeiro vencimento: ${d.dataVencimento}

📌 Informações adicionais:

• O controle de capital e lucro desta operação é atualizado automaticamente a cada parcela recebida.

Qualquer dúvida, estamos à disposição.`,

  MONTHLY: (d: MessageData) => `Olá, ${d.nomeCliente}.

Seu contrato foi criado com sucesso em nosso sistema.

📄 Informações do contrato:

• Número do contrato: # ${d.idContrato}
• Modalidade: Mensal
• Valor emprestado: ${d.valorEmprestado}
• Taxa de juros: ${d.taxaJuros}%

💰 Opções de pagamento:

• Pagamento dos juros do mês: ${d.valorJuros || "---"}
• Pagamento total para quitação: ${d.valorTotal}

📅 Data de vencimento:
• ${d.dataVencimento}

📌 Informações importantes:

• Caso seja realizado apenas o pagamento dos juros, o contrato continuará ativo para o próximo mês.
• Caso seja realizado o pagamento total, o contrato será encerrado automaticamente.

📌 Informações sobre atraso:

• Multa de R$ 20 por dia de atraso

⚠️ Após o vencimento, as taxas de atraso serão adicionadas automaticamente ao valor em aberto.

Qualquer dúvida, estamos à disposição.`,

  WEEKLY: (d: MessageData) => `Olá, ${d.nomeCliente}.

Seu contrato foi criado com sucesso em nosso sistema.

📄 Informações do contrato:

• Número do contrato: # ${d.idContrato}
• Modalidade: Semanal
• Valor emprestado: ${d.valorEmprestado}
• Taxa de juros: ${d.taxaJuros}%
• Valor total do contrato: ${d.valorTotal}

💰 Forma de pagamento:

• Quantidade de parcelas: 4 parcelas semanais
• Valor da parcela semanal: ${d.valorParcela || "---"}
• Primeira parcela vence em: ${d.dataVencimento}

📌 Informações sobre atraso:

• Multa de R$ 15 por dia de atraso

⚠️ Após o vencimento, as taxas de atraso serão adicionadas automaticamente ao valor em aberto.

Qualquer dúvida, estamos à disposição.`,

  DAILY: (d: MessageData) => `Olá, ${d.nomeCliente}.

Seu contrato foi criado com sucesso em nosso sistema.

📄 Informações do contrato:

• Número do contrato: # ${d.idContrato}
• Modalidade: Diário
• Valor emprestado: ${d.valorEmprestado}
• Taxa de juros: ${d.taxaJuros}%
• Valor total do contrato: ${d.valorTotal}

💰 Forma de pagamento:

• Quantidade de parcelas: 20 parcelas
• Valor da parcela diária: ${d.valorParcela || "---"}
• Primeira parcela vence em: ${d.dataVencimento}

📌 Informações sobre atraso:

• Multa de R$ 5 por dia de atraso

⚠️ Após o vencimento, as taxas de atraso serão adicionadas automaticamente ao valor em aberto.

Qualquer dúvida, estamos à disposição.`
};
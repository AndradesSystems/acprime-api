import type { Client, Contract, ContractInstallment } from "../generated/prisma/client";
import { formatInTimeZone } from 'date-fns-tz';

// --- TIPAGENS REAIS DO SEU SCHEMA ---
export type CompleteContract = Contract & {
  client: Client;
  installments: ContractInstallment[];
};

// --- FUNÇÕES AUXILIARES ---

export const sleep = (ms: number): Promise<void> => 
  new Promise((resolve) => setTimeout(resolve, ms));

export const fmtCurrency = (v: any): string => {
  const value = typeof v === "object" && v?.toNumber ? v.toNumber() : Number(v);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
};

/**
 * Formata a data olhando estritamente para o fuso UTC gravado no banco,
 * evitando que o dia retroceda por causa do fuso local.
 */
export function fmtDate(date: Date | string): string {
  return formatInTimeZone(new Date(date), 'UTC', 'dd/MM/yyyy');
}

/**
 * Força a leitura de uma data vinda do banco como Meia-Noite UTC pura,
 * eliminando deslocamentos locais de fuso.
 */
export const parseDBDateUTC = (date: Date | string): Date => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
};

/**
 * Captura a data atual com base no calendário civil de Brasília (America/Sao_Paulo)
 * e gera um objeto Date zerado em UTC (ex: "2026-06-04T00:00:00.000Z").
 * Isso impede que o sistema mude para o dia seguinte antes da meia-noite do Brasil.
 */
export const getTodayMidnightUTC = (): Date => {
  const dataNoBrasilStr = formatInTimeZone(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  return new Date(`${dataNoBrasilStr}T00:00:00.000Z`);
};

/**
 * Compara se duas datas correspondem ao mesmo dia em UTC pura.
 */
export function isSameDayUTC(d1: Date | string, d2: Date | string): boolean {
  const date1 = parseDBDateUTC(d1);
  const date2 = parseDBDateUTC(d2);
  return date1.getTime() === date2.getTime();
}

/**
 * Calcula a diferença exata de dias entre duas datas em UTC pura.
 */
export function differenceInDaysUTC(d1: Date | string, d2: Date | string): number {
  const date1 = parseDBDateUTC(d1);
  const date2 = parseDBDateUTC(d2);
  return Math.round((date1.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24));
}
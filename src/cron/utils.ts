import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Client, Contract, ContractInstallment } from "../generated/prisma/client";

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

export const fmtDate = (dateInput: Date | string | null): string => {
  if (!dateInput) return "";
  return format(new Date(dateInput), "dd/MM/yyyy", { locale: ptBR });
};

export const getMidnightUTC = (date: Date | string): Date => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
};
import type { ContractPeriodicity } from "../generated/prisma/enums";

/**
 * Retorna a diferença em dias inteiros entre duas datas
 * (ignorando horas, minutos, segundos)
 */
export function diffDays(from: Date, to: Date): number {
  const start = startOfDay(from).getTime();
  const end = startOfDay(to).getTime();

  const diffMs = end - start;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Retorna uma nova Date no início do dia (00:00:00)
 */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function prorrogateDueDate(
  vencimentoAtual: Date,
  periodicity: ContractPeriodicity
) {
  const newDate = new Date(vencimentoAtual);

  switch (periodicity) {
    case "DAILY":
      newDate.setDate(newDate.getDate() + 1);
      break;

    case "WEEKLY":
      newDate.setDate(newDate.getDate() + 7);
      break;

    case "MONTHLY":
      newDate.setMonth(newDate.getMonth() + 1);
      break;
  }

  return newDate;
}



import type { Prisma } from "../generated/prisma/client";

export type PaymentType = "JUROS" | "PRINCIPAL" | "MISTO" | "PERSONALIZADO";

export interface CreatePaymentInput {
  tipo: PaymentType;
  valorPago: number;
  observacao?: string;
  valorDestinadoTaxa?: number;
}

export interface IPaymentStrategy {
  processPayment(
    tx: Prisma.TransactionClient,
    contract: any,
    data: CreatePaymentInput,
    userId: string
  ): Promise<number>; // Retorna o principal acumulado pago para atualizar caixa

  processReversal(
    tx: Prisma.TransactionClient,
    payment: any,
    amounts: { principal: number; juros: number; taxa: number }
  ): Promise<void>;
}
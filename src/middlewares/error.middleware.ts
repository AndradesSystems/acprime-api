import { type Request, type Response, type NextFunction } from "express";

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Erros "conhecidos"
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  // Erros genéricos (não vazar detalhes em produção)
  const message =
    err instanceof Error ? err.message : "Erro interno inesperado";

  return res.status(500).json({
    message: process.env.NODE_ENV === "production" ? "Erro interno" : message,
  });
}

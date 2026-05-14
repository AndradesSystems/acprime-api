import { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { verifyToken, type AuthPayload } from "../lib/jwt";
import { UserService } from "../services/user.service";

type AuthedHandler = (req: Request, res: Response, next: NextFunction, auth: AuthPayload) => any;

async function getValidatedAuth(req: Request, adminOnly: boolean = false): Promise<AuthPayload> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    console.warn("[AUTH] [WARN] Tentativa de acesso sem header de autorização.");
    throw new Error("Token não fornecido");
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    console.warn(`[AUTH] [WARN] Formato de header inválido: ${scheme}`);
    throw new Error("Formato inválido");
  }

  try {
    console.debug("[AUTH] [DEBUG] Iniciando verificação de token JWT...");
    const payload = verifyToken(token);
    console.debug(`[AUTH] [DEBUG] Token decodificado. Sub: ${payload.sub}, Tipo: ${payload.tipo}, Email: ${payload.email}`);

    // 1. Validação de Integridade (Status/Vencimento) - Pula se for ADMIN
    if (payload.tipo !== "ADMIN") {
      console.debug(`[AUTH] [DEBUG] Usuário não-admin identificado (${payload.tipo}). Consultando banco de dados para ${payload.email}...`);
      
      if (!payload.email) {
        console.error("[AUTH] [ERROR] Payload do Token não contém email. Validação no banco impossível.");
        throw new Error("Token inválido: falta e-mail");
      }

      await UserService.validateAccess(payload.email);
      console.debug(`[AUTH] [DEBUG] Validação de status/vencimento aprovada para: ${payload.email}`);
    } else {
      console.debug("[AUTH] [DEBUG] Usuário ADMIN detectado. Ignorando checagem de status/vencimento.");
    }

    // 2. Restrição de Admin (se a rota exigir)
    if (adminOnly && payload.tipo !== "ADMIN") {
      console.warn(`[AUTH] [WARN] Acesso Negado: Rota restrita a ADMIN. Usuário atual: ${payload.tipo}`);
      throw new Error("ACESSO_NEGADO_ADMIN");
    }

    return payload;
  } catch (err: any) {
    console.error(`[AUTH] [ERROR] Falha na validação de acesso: ${err.message}`);
    throw new Error(err.message || "Token inválido ou expirado");
  }
}

/**
 * Middleware Universal: Valida Token + Status no Banco + Vencimento.
 */
export function withAuth(handler: AuthedHandler): RequestHandler {
  return async (req, res, next) => {
    const method = req.method;
    const url = req.originalUrl;
    
    try {
      const auth = await getValidatedAuth(req, false);
      console.info(`[AUTH] [INFO] Acesso liberado para ${auth.email} em [${method}] ${url}`);
      return handler(req, res, next, auth);
    } catch (e: any) {
      const isBusinessError = e.message.includes("expirou") || e.message.includes("bloqueada") || e.message.includes("falta e-mail");
      const status = isBusinessError ? 403 : 401;
      
      console.error(`[AUTH] [RESULT] Bloqueado em [${method}] ${url}. Status: ${status}. Motivo: ${e.message}`);
      return res.status(status).json({ message: e.message });
    }
  };
}

/**
 * Middleware Administrativo: Valida Token + Garante que é ADMIN.
 */
export function withAdmin(handler: AuthedHandler): RequestHandler {
  return async (req, res, next) => {
    const method = req.method;
    const url = req.originalUrl;

    try {
      const auth = await getValidatedAuth(req, true);
      console.info(`[AUTH] [INFO] ADMIN ${auth.email} acessou [${method}] ${url}`);
      return handler(req, res, next, auth);
    } catch (e: any) {
      const isForbidden = e.message === "ACESSO_NEGADO_ADMIN" || e.message.includes("expirou") || e.message.includes("bloqueada");
      const status = isForbidden ? 403 : 401;
      
      console.error(`[AUTH] [RESULT] ADMIN_RESTRITO em [${method}] ${url}. Status: ${status}. Motivo: ${e.message}`);
      const message = e.message === "ACESSO_NEGADO_ADMIN" ? "Requer privilégios de administrador." : e.message;
      return res.status(status).json({ message });
    }
  };
}
import jwt, { type JwtPayload } from "jsonwebtoken";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET não definida no .env");
  return secret;
}

export type AuthPayload = JwtPayload & {
  sub: string;
  email: string;
  tipo: "ADMIN" | "OPERADOR" | "ASSINANTE";
  plan: "VAZIO" | "STARTER" | "PRO"; // 🔴 Incluído na tipagem do Payload
  vencimento: Date | null;
};

export function signToken(payload: { 
  sub: string; 
  email: string; 
  tipo: AuthPayload["tipo"];
  plan: AuthPayload["plan"]; // 🔴 Requerido ao assinar o token
  vencimento: Date | null;
}) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "1d" });
}

export function verifyToken(token: string): AuthPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Token inválido");
  }

  const d = decoded as Partial<AuthPayload>;
  
  // Verificação rigorosa para garantir que os dados necessários para o wrapper existam
  if (typeof d.sub !== "string" || typeof d.email !== "string") {
    throw new Error("Token inválido: identificação incompleta");
  }

  if (d.tipo !== "ADMIN" && d.tipo !== "OPERADOR" && d.tipo !== "ASSINANTE") {
    throw new Error("Token inválido: Tipo de usuário desconhecido");
  }

  return decoded as AuthPayload;
}
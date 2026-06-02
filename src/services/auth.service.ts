import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/jwt";
import { AppError } from "../middlewares/error.middleware";
import { UserService } from "./user.service";

export class AuthService {
  static async login({
    email,
    senha,
  }: {
    email: string;
    senha: string;
  }) {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    console.log("DADOS DO USER", user);

    if (!user) {
      throw new AppError("Credenciais inválidas", 401);
    }

    const ok = await bcrypt.compare(senha, user.senhaHash);
    if (!ok) {
      throw new AppError("Credenciais inválidas", 401);
    }

    if (user.tipo !== "ADMIN") {
      await UserService.validateAccess(user.email);
    }

    // Passando o email e o plano para dentro do Token
    const token = signToken({
      sub: user.id,
      email: user.email, 
      tipo: user.tipo as any,
      plan: (user.plan as any) || "VAZIO", // 🔴 Injetando o plano no Token (Fallback para VAZIO se for nulo)
      vencimento: user.vencimento
    });

    return {
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        tipo: user.tipo,
        plan: user.plan || "VAZIO", // 🔴 Retornando o plano no payload de resposta inicial do login
        vencimento: user.vencimento
      },
    };
  }
}
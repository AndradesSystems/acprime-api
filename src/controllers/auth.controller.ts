import { type Request, type Response } from "express";
import { AuthService } from "../services/auth.service";

export class AuthController {
  static async login(req: Request, res: Response) {
    try {
      const result = await AuthService.login(req.body);
      return res.json(result);
    } catch (err: any) {
      return res.status(err.statusCode || 401).json({
        message: err.message || "Erro ao autenticar",
      });
    }
  }
}

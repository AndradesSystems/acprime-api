import { type Request, type Response, type NextFunction } from "express";
import { DashboardService } from "../services/dashboard.service";
import { type AuthPayload } from "../lib/jwt";

export class DashboardController {
  static async summary(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { startDate, endDate } = req.query;

      // Chama o serviço passando os parâmetros
      const data = await DashboardService.getSummary(
        auth.sub,
        startDate as string,
        endDate as string
      );

      return res.json(data);
    } catch (e) {
      console.error("[DashboardController] Error:", e);
      return next(e);
    }
  }
}

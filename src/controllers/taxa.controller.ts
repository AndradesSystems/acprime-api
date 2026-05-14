import { type Request, type Response, type NextFunction } from "express";
import { TaxaService } from "../services/taxa.service";

export class TaxaController {
  /**
   * Lista todas as taxas para o Admin
   */
  static async list(
    _req: Request, 
    res: Response, 
    next: NextFunction
  ) {
    try {
      const taxas = await TaxaService.list();
      return res.json(taxas);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Atualiza ou cria uma taxa (ex: MENSAL, ANUAL)
   */
  static async update(
    req: Request, 
    res: Response, 
    next: NextFunction
  ) {
    try {
      // Espera { type: "MONTHLY", value: 150.00 }
      const taxa = await TaxaService.update(req.body);
      return res.json(taxa);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Busca uma taxa específica
   */
  static async getByType(
    req: Request, 
    res: Response, 
    next: NextFunction
  ) {
    try {
      const { type } = req.params;
      const taxa = await TaxaService.getByType(type as any);
      return res.json(taxa);
    } catch (e) {
      return next(e);
    }
  }
}
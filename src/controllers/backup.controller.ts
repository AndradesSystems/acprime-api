import { type Request, type Response, type NextFunction } from "express";
import { BackupService, type ExportType } from "../services/backup.service";
import { type AuthPayload } from "../lib/jwt";

export class BackupController {
  /**
   * 💾 EXPORTAR DADOS
   */
  static async export(req: Request, res: Response, next: NextFunction, auth: AuthPayload) {
    try {
      const type = (req.query.type as ExportType) || "TOTAL";
      const dataSnapshot = await BackupService.exportDataByUser(auth.sub, type);

      res.setHeader("Content-Disposition", `attachment; filename=backup-${type.toLowerCase()}.json`);
      res.setHeader("Content-Type", "application/json");

      return res.json(dataSnapshot);
    } catch (e) {
      return next(e);
    }
  }

  /**
   * 📥 IMPORTAR DADOS
   */
  static async import(req: Request, res: Response, next: NextFunction, _auth: AuthPayload) {
    try {
      const backupData = req.body;

      if (!backupData || !backupData.tables) {
        return res.status(400).json({ error: "Arquivo de backup inválido." });
      }

      const result = await BackupService.importAllData(backupData);
      return res.status(200).json(result);
    } catch (e) {
      return next(e);
    }
  }
}
import { type Request, type Response } from "express";
import { BackupService } from "../services/backup.service";

export class BackupController {
  static async download(req: Request, res: Response) {
    try {
      const backup = await BackupService.exportAllData();
      res.setHeader("Content-Disposition", "attachment; filename=backup.json");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify(backup, null, 2));
    } catch (error: any) {
      return res.status(500).json({ error: "Erro ao exportar: " + error.message });
    }
  }

  static async restore(req: Request, res: Response) {
    try {
      const backupData = req.body;
      if (!backupData || !backupData.tables) {
        return res.status(400).json({ error: "Arquivo de backup inválido ou vazio." });
      }
      await BackupService.importAllData(backupData);
      return res.status(200).json({ message: "Dados restaurados com sucesso!" });
    } catch (error: any) {
      console.error("Erro no Restore:", error);
      return res.status(500).json({ error: "Falha na restauração: " + error.message });
    }
  }
}
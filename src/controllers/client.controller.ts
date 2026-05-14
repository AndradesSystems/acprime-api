import { type Request, type Response, type NextFunction } from "express";
import { ClientService } from "../services/client.service";
import { type AuthPayload } from "../lib/jwt";

export class ClientController {
  static async create(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      // O userId vem obrigatoriamente do token (auth.sub)
      const client = await ClientService.create({
        ...req.body,
        userId: auth.sub,
      });
      return res.status(201).json(client);
    } catch (e) {
      return next(e);
    }
  }

  static async list(
    _req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      // Passa o ID do usuário logado para filtrar apenas os clientes dele
      const clients = await ClientService.list(auth.sub);
      return res.json(clients);
    } catch (e) {
      return next(e);
    }
  }

  static async getById(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do cliente é obrigatório." });
      }

      const client = await ClientService.getById(id, auth.sub);

      return res.json(client);
    } catch (e) {
      return next(e);
    }
  }

  static async update(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do cliente é obrigatório." });
      }

      const updatedClient = await ClientService.update(
        id,
        auth.sub,
        req.body
      );

      return res.json(updatedClient);
    } catch (e) {
      return next(e);
    }
  }

  static async remove(
    req: Request,
    res: Response,
    next: NextFunction,
    auth: AuthPayload
  ) {
    try {
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: "O ID do cliente é obrigatório." });
      }

      await ClientService.remove(id, auth.sub);

      return res.status(204).send();
    } catch (e) {
      return next(e);
    }
  }
}
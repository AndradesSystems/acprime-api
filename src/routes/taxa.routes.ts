import { Router } from "express";
import { TaxaController } from "../controllers/taxa.controller";
import { withAuth } from "../middlewares/auth.wrapper";

const taxaRoutes = Router();

/**
 * @desc Lista todas as taxas configuradas no sistema
 * Acessível via GET /taxas (ou o prefixo definido no arquivo principal)
 */
taxaRoutes.get(
  "/", 
  withAuth(TaxaController.list)
);

/**
 * @desc Busca o valor de uma taxa específica (ex: MONTHLY, DAILY)
 * Acessível via GET /taxas/:type
 */
taxaRoutes.get(
  "/:type", 
  withAuth(TaxaController.getByType)
);

/**
 * @desc Atualiza ou cria uma taxa (Upsert)
 * Acessível via PUT /taxas
 */
taxaRoutes.put(
  "/", 
  withAuth(TaxaController.update)
);

export default taxaRoutes;
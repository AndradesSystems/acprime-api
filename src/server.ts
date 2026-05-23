import { app } from "./app";
import { conectarWhatsApp, enviarMensagemLivre } from "./whapp";

const PORT = process.env.PORT || 4004;

app.listen(PORT, async () => {
  console.log(`\n==================================================`);
  console.log(`🚀 [SERVER-START] Servidor rodando na porta ${PORT}`);
  console.log(`==================================================`);
 
});


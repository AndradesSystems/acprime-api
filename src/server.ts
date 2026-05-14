import { app } from "./app";
import { initCronJobs } from "./crons";

const PORT = process.env.PORT || 4004;

// Inicializa os agendamentos
// initCronJobs();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
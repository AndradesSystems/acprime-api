import express from "express";
import cors from "cors";
import routes from "./routes/routes";
import { errorMiddleware } from "./middlewares/error.middleware";

export const app = express();

const allowedOrigins = [
  "http://localhost:8080",
  "https://acprime.vercel.app"
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(routes);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(errorMiddleware);
import cors from "cors";
import express from "express";
import swaggerUi from 'swagger-ui-express';
import YAML from "yamljs";
import path from "path";
import { fileURLToPath } from "url";

import dotenv from "dotenv";
dotenv.config();

// Routes
import authRoutes from "./routes/auth.js";
import patientRoutes from "./routes/patients.js";
import sessionsRoutes from "./routes/sessions.js";
import reportsRoutes from "./routes/reports.js";
// New: Import Chat Router
import chatRoutes from "./routes/chat.js"; 

// Middleware
import authMiddleware from "./middleware/authMiddleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Load Swagger YAML =====
const swaggerDocument = YAML.load(path.join(__dirname, "openApi.yaml"));

// ========== CONFIG ==========
const app = express();
const port = 3000;
app.use(express.json());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow all origins (localhost, Cloudflare tunnels, etc.)
      callback(null, true);
    },
    credentials: true,
  })
);

// ===== Swagger UI =====
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get("/api-docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerDocument);
});

// Rute dasar
app.use("/api/auth", authRoutes);

// ========== ROUTE REGISTER ==========
// Rute yang membutuhkan autentikasi level user/admin
app.use("/api/patients", authMiddleware(["user", "admin"]), patientRoutes);
app.use("/api/sessions", authMiddleware(["user", "admin"]), sessionsRoutes);
app.use("/api/reports", authMiddleware(["user", "admin"]), reportsRoutes);
app.use("/api/chat", chatRoutes); 

// ========== RUN ==========
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
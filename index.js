import cors from "cors";
import express from "express";
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

// Hapus import services/constants yang terkait chat, karena sudah dipindah ke chat.js

// ========== CONFIG ==========
const app = express();
const port = 3000;
app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

// ========== ROUTE REGISTER ==========
// Rute yang membutuhkan autentikasi level user/admin
app.use("/api/patients", authMiddleware(["user", "admin"]), patientRoutes);
app.use("/api/sessions", authMiddleware(["user", "admin"]), sessionsRoutes);
app.use("/api/reports", authMiddleware(["user", "admin"]), reportsRoutes);
app.use("/api/chat", chatRoutes); 

// Rute dasar
app.use("/api/auth", authRoutes);

// ========== RUN ==========
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
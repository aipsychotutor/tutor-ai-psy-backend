import cors from "cors";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

// Routes
import authRoutes from "./routes/auth.js";
import patientRoutes from "./routes/patients.js";
import sessionsRoutes from "./routes/sessions.js";
import reportsRoutes from "./routes/reports.js";

// Middleware
import authMiddleware from "./middleware/authMiddleware.js";

// Services
import { getPersonaForSession, setPersonaFromPatient } from "./services/personaService.js";
import { processChatMessage } from "./services/chatService.js";
import { getSessionTranscripts } from "./services/transcriptService.js";
import { checkSession, startSession, endSession } from "./services/sessionService.js";
import { geminiApiKey, elevenLabsApiKey } from "./constant.js";

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
app.use("/api/auth", authRoutes);
app.use("/api/patients", authMiddleware(["user", "admin"]), patientRoutes);
app.use("/api/sessions", authMiddleware(["user", "admin"]), sessionsRoutes);
app.use("/api/reports", authMiddleware(["user", "admin"]), reportsRoutes);

// ========== BASIC ROUTES ==========
app.get("/", (req, res) => res.send("Hello World!"));

// ========== SESSION ROUTES ==========
app.get("/session/:session_id", async (req, res) => {
  try {
    const { session_id } = req.params;
    const result = await checkSession(session_id);
    
    if (!result.exists) {
      return res
        .status(404)
        .json({ exists: false, message: "Session tidak ditemukan" });
    }
    
    res.json({ exists: true, session: result.session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/start-session", authMiddleware, async (req, res) => {
  try {
    const { patient_id } = req.body;
    const user_id = req.user.user_id;
    
    const session = await startSession(user_id, patient_id);
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/end-session/:session_id", authMiddleware, async (req, res) => {
  try {
    const { session_id } = req.params;
    const user_id = req.user.user_id;
    
    const session = await endSession(session_id, user_id);
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== PERSONA ROUTES ==========
app.get("/persona/:session_id", async (req, res) => {
  try {
    const persona = await getPersonaForSession(req.params.session_id);
    res.json({ success: true, persona });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post("/set-persona-from-patient", async (req, res) => {
  try {
    const { patient_id } = req.body;

    if (!patient_id) {
      return res.status(400).json({
        success: false,
        message: "patient_id is required",
      });
    }

    const result = await setPersonaFromPatient(patient_id);
    
    res.json({
      success: true,
      message: "Persona berhasil diset dari data patient",
      activePersona: result.activePersona,
      patient_id: result.patient_id,
    });
  } catch (err) {
    console.error("❌ Error setting persona from patient:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ========== CHAT ROUTE ==========
app.post("/chat", async (req, res) => {
  const { message: userMessage, prosody_data, session_id } = req.body;

  // ========== VALIDATION ==========
  if (!userMessage) {
    console.log("⚠️ [VALIDATION] No message provided, returning default greeting");
    return res.send({
      messages: [
        {
          text: "Hai... bagaimana kabarmu hari ini?",
          facialExpression: "smile",
          animation: "Talking_1",
          audio: null,
        },
      ],
    });
  }

  if (!geminiApiKey || !elevenLabsApiKey) {
    console.error("❌ [VALIDATION] API keys missing!");
    console.error("   - Gemini API Key:", geminiApiKey ? "✓ Set" : "✗ Missing");
    console.error(
      "   - ElevenLabs API Key:",
      elevenLabsApiKey ? "✓ Set" : "✗ Missing"
    );
    return res.status(500).json({ message: "API key belum diset." });
  }

  try {
    const messages = await processChatMessage(userMessage, session_id, prosody_data);
    res.json({ success: true, messages });

  } catch (err) {
    console.error("\n" + "=".repeat(70));
    console.error("❌ [ERROR] Fatal error in /chat route");
    console.error("=".repeat(70));
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    console.error("Error name:", err.name);
    if (err.response) {
      console.error("API Response status:", err.response.status);
      console.error("API Response data:", err.response.data);
    }
    console.error("=".repeat(70) + "\n");

    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== TRANSCRIPTS ROUTE ==========
app.get(
  "/session/:session_id/transcripts",
  authMiddleware,
  async (req, res) => {
    try {
      const { session_id } = req.params;
      const user_id = req.user.user_id;
      
      const data = await getSessionTranscripts(session_id, user_id);
      res.json(data);

    } catch (error) {
      if (error.message.includes("tidak ditemukan")) {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

// ========== RUN ==========
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
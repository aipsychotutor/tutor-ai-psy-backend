import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { getPersonaForSession, setPersonaFromPatient } from "../services/personaService.js";
import { processChatMessage } from "../services/chatService.js";
import { getSessionTranscripts } from "../services/transcriptService.js";
import { geminiApiKey, elevenLabsApiKey } from "../constant.js";

const router = express.Router();

/**
 * @route GET /api/chat/persona/:session_id
 * @description Mendapatkan persona aktif untuk sesi tertentu.
 */
router.get("/persona/:session_id", async (req, res) => {
  try {
    const persona = await getPersonaForSession(req.params.session_id);
    res.json({ success: true, persona });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * @route POST /api/chat/set-persona-from-patient
 * @description Mengatur persona sesi berdasarkan data pasien.
 */
router.post("/set-persona-from-patient", async (req, res) => {
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

/**
 * @route POST /api/chat/
 * @description Endpoint utama untuk interaksi chat/AI.
 */
router.post("/", async (req, res) => {
  const { message: userMessage, prosody_data, session_id } = req.body;

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

export default router;
import express from "express";
import { getPersonaForSession, setPersonaFromPatient } from "../services/personaService.js";
import { processChatMessage } from "../services/chatService.js";
import { geminiApiKey, elevenLabsApiKey } from "../constant.js";

const router = express.Router();

router.get("/persona/:session_id", async (req, res) => {
  try {
    const persona = await getPersonaForSession(req.params.session_id);
    res.json({ success: true, persona });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

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
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

router.post("/", async (req, res) => {
  const { message: userMessage, prosody_data, session_id } = req.body;

  if (!userMessage) {
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
    return res.status(500).json({ message: "API key belum diset." });
  }

  try {
    const messages = await processChatMessage(userMessage, session_id, prosody_data);
    res.json({ success: true, messages });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
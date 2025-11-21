import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { getPersonaForSession, setPersonaFromPatient } from "../services/personaService.js";
import { processChatMessage } from "../services/chatService.js";
import { getSessionTranscripts } from "../services/transcriptService.js";
import { geminiApiKey, elevenLabsApiKey } from "../constant.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Chat
 *     description: Endpoint untuk interaksi chat dengan AI counselor
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Persona:
 *       type: object
 *       properties:
 *         persona_id:
 *           type: string
 *           format: uuid
 *         session_id:
 *           type: string
 *           format: uuid
 *         name:
 *           type: string
 *           example: Sarah
 *         age:
 *           type: integer
 *           example: 28
 *         gender:
 *           type: string
 *           example: Perempuan
 *         background:
 *           type: string
 *           example: Mahasiswa tingkat akhir yang mengalami kecemasan
 *         communication_style:
 *           type: string
 *           example: Tenang dan supportif
 *     SetPersonaRequest:
 *       type: object
 *       required:
 *         - patient_id
 *       properties:
 *         patient_id:
 *           type: string
 *           format: uuid
 *           description: ID pasien yang akan digunakan untuk membuat persona
 *     ChatRequest:
 *       type: object
 *       required:
 *         - message
 *       properties:
 *         message:
 *           type: string
 *           description: Pesan dari counselor/user
 *           example: Bagaimana perasaan kamu hari ini?
 *         session_id:
 *           type: string
 *           format: uuid
 *           description: ID sesi konseling (opsional)
 *         prosody_data:
 *           type: object
 *           description: Data prosodi suara untuk analisis (opsional)
 *           properties:
 *             pitch:
 *               type: number
 *             energy:
 *               type: number
 *             speaking_rate:
 *               type: number
 *     ChatMessage:
 *       type: object
 *       properties:
 *         text:
 *           type: string
 *           description: Teks respon dari AI
 *           example: Saya merasa cukup baik hari ini, terima kasih sudah bertanya.
 *         facialExpression:
 *           type: string
 *           description: Ekspresi wajah avatar
 *           enum: [smile, sad, neutral, surprised, thinking]
 *           example: smile
 *         animation:
 *           type: string
 *           description: Animasi avatar
 *           example: Talking_1
 *         audio:
 *           type: string
 *           nullable: true
 *           description: Base64 encoded audio atau URL audio
 *     ChatResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChatMessage'
 */

/**
 * @swagger
 * /chat/persona/{session_id}:
 *   get:
 *     summary: Mendapatkan persona aktif untuk sesi
 *     description: Mengambil informasi persona (karakter pasien virtual) yang sedang aktif untuk sesi konseling tertentu.
 *     tags: [Chat]
 *     parameters:
 *       - in: path
 *         name: session_id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: ID unik sesi konseling
 *     responses:
 *       200:
 *         description: Persona berhasil diambil
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 persona:
 *                   $ref: '#/components/schemas/Persona'
 *       500:
 *         description: Error server saat mengambil persona
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
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
 * @swagger
 * /chat/set-persona-from-patient:
 *   post:
 *     summary: Mengatur persona sesi dari data pasien
 *     description: Membuat dan mengaktifkan persona virtual berdasarkan data pasien yang sudah ada. Persona ini akan digunakan oleh AI untuk roleplay sebagai pasien dalam sesi konseling.
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SetPersonaRequest'
 *     responses:
 *       200:
 *         description: Persona berhasil diset dari data pasien
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Persona berhasil diset dari data patient
 *                 activePersona:
 *                   $ref: '#/components/schemas/Persona'
 *                 patient_id:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Patient ID tidak disediakan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: patient_id is required
 *       500:
 *         description: Error server saat setting persona
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
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
 * @swagger
 * /chat:
 *   post:
 *     summary: Kirim pesan chat ke AI counselor
 *     description: Endpoint utama untuk berinteraksi dengan AI counselor. Mengirim pesan dan menerima respons dalam bentuk teks, ekspresi wajah, animasi, dan audio. AI akan berperan sebagai pasien virtual (persona) dalam sesi konseling.
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *     responses:
 *       200:
 *         description: Pesan berhasil diproses dan respons AI dikembalikan
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
 *             examples:
 *               with_message:
 *                 summary: Respons dengan pesan user
 *                 value:
 *                   success: true
 *                   messages:
 *                     - text: Saya merasa sedikit cemas akhir-akhir ini...
 *                       facialExpression: sad
 *                       animation: Talking_1
 *                       audio: base64_encoded_audio_string
 *               default_greeting:
 *                 summary: Respons default (tanpa pesan user)
 *                 value:
 *                   messages:
 *                     - text: Hai... bagaimana kabarmu hari ini?
 *                       facialExpression: smile
 *                       animation: Talking_1
 *                       audio: null
 *       500:
 *         description: Error server (API key tidak tersedia atau error processing)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: API key belum diset.
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
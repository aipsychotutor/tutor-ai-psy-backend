import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import { supabase } from "./supabase.js";
import { promises as fs } from "fs";
import { GoogleGenAI } from "@google/genai";
import authRoutes from "./routes/auth.js";
import patientRoutes from "./routes/patients.js";
import sessionsRoutes from './routes/sessions.js';
dotenv.config();

const geminiApiKey = process.env.GEMINI_API_KEY;
console.log(process.env.NAMA_API_KEY)
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "21m00Tcm4TlvDq8ikWAM";

const app = express();
app.use(express.json());
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true,
}));
app.use("/api/auth", authRoutes);
app.use("/api/patients", patientRoutes);
app.use('/api/sessions', sessionsRoutes);
const port = 3000;

const promptTemplate = `
Anda berperan sebagai seorang pasien bernama {{nama_pasien}} yang sedang berkonsultasi dengan psikolog.
Berikut adalah profil lengkap Anda yang harus dijadikan dasar untuk semua respons:

---
### PROFIL PASIEN

**Biodata:**
{{biodata}}

**Latar Belakang Cerita:**
{{latar_belakang_cerita}}

**Kepribadian:**
{{kepribadian}}
---

Anda sedang berinteraksi dengan seorang psikolog dalam konteks sesi konsultasi pertama.
Jawablah setiap pertanyaan atau pernyataan psikolog secara alami, sesuai dengan profil di atas.

⚠️ Aturan Output Penting:
1. Jawaban WAJIB berupa JSON array valid TANPA teks atau penjelasan lain di luar JSON.
2. Setiap objek JSON harus berformat:
    { "text": "...", "facialExpression": "...", "animation": "..." }
3. "facialExpression" hanya boleh dari daftar ini: ["smile", "sad", "angry", "surprised", "funnyFace", "default"].
4. "animation" hanya boleh dari daftar ini: ["Talking_0", "Talking_1", "Talking_2", "Crying", "Laughing", "Rumba", "Idle", "Terrified", "Angry"].

User: {{userMessage}}
`;

// 🎭 Persona Default: Maya
const personaMaya = {
  nama_pasien: "Maya (Josephine Elsje Basudara)",
  biodata: `- Usia: 25 tahun
- Jenis Kelamin: Perempuan
- Pekerjaan: Pemilik Bisnis Boneka Labubu
- Status: Lajang`,
  latar_belakang_cerita: `Saya merintis usaha boneka Labubu sejak 5 tahun lalu. Awalnya bisnis berjalan lancar, tapi belakangan ini saya merasa kewalahan. Permintaan pasar menurun dan kompetitor bertambah. Saya merasa usaha saya stagnan dan sangat takut kehilangan bisnis ini yang sudah saya anggap seperti 'anak sendiri'.`,
  kepribadian: `- Kreatif dan detail-oriented.
- Seorang perfeksionis, sulit mendelegasikan tugas.
- Emosional dan sangat terikat dengan hasil karya.
- Terlihat ramah kepada pelanggan, tapi tertutup mengenai masalah pribadi.`
};

// 💾 Variabel untuk menyimpan persona aktif (dalam memori)
let activePersona = personaMaya;

// 🛠️ Fungsi untuk mengganti placeholder di template
function fillTemplate(template, data) {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const placeholder = `{{${key}}}`;
    result = result.replaceAll(placeholder, value);
  }
  return result;
}

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/session/:session_id", async (req, res) => {
  const { session_id } = req.params;

  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", session_id)
    .single();

  if (error && error.code !== "PGRST116") {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    return res.status(404).json({ exists: false, message: "Session tidak ditemukan" });
  }

  res.json({ exists: true, session: data });
});

// 🆕 Endpoint untuk mendapatkan template dan persona default
app.get("/prompt", (req, res) => {
  res.json({
    template: promptTemplate,
    defaultPersona: personaMaya,
    validExpressions: ["smile", "sad", "angry", "surprised", "funnyFace", "default"],
    validAnimations: [
      "Talking_0", "Talking_1", "Talking_2", "Crying", "Laughing", 
      "Rumba", "Idle", "Terrified", "Angry"
    ]
  });
});

// 🆕 Endpoint untuk mendapatkan daftar persona (bisa diperluas nanti)
app.get("/personas", (req, res) => {
  res.json({
    personas: [
      {
        id: "maya",
        nama: "Maya (Josephine Elsje Basudara)",
        deskripsi: "Pemilik bisnis boneka Labubu yang sedang menghadapi tekanan bisnis",
        data: personaMaya
      }
      // Bisa tambahkan persona lain di sini
    ]
  });
});

// 🆕 Endpoint untuk SET persona aktif
app.post("/set-persona", (req, res) => {
  const { persona } = req.body;

  if (!persona) {
    return res.status(400).json({
      success: false,
      message: "Persona tidak boleh kosong"
    });
  }

  // Validasi apakah persona memiliki field yang diperlukan
  const requiredFields = ["nama_pasien", "biodata", "latar_belakang_cerita", "kepribadian"];
  const missingFields = requiredFields.filter(field => !persona[field]);

  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Field berikut harus diisi: ${missingFields.join(", ")}`
    });
  }

  // Set persona aktif
  activePersona = persona;
  console.log("✅ Persona berhasil diubah:", activePersona.nama_pasien);

  res.json({
    success: true,
    message: "Persona berhasil diset",
    activePersona: activePersona
  });
});

// 🆕 Endpoint untuk GET persona aktif saat ini
app.get("/active-persona", (req, res) => {
  res.json({
    success: true,
    activePersona: activePersona
  });
});

// 🆕 Endpoint untuk RESET persona ke default (Maya)
app.post("/reset-persona", (req, res) => {
  activePersona = personaMaya;
  console.log("🔄 Persona direset ke default:", activePersona.nama_pasien);

  res.json({
    success: true,
    message: "Persona berhasil direset ke default (Maya)",
    activePersona: activePersona
  });
});

app.post("/chat", async (req, res) => {
  const { message: userMessage, session_id } = req.body;
  if (!userMessage) return res.send({ messages: [{ text: "Hai... bagaimana kabarmu hari ini?", facialExpression: "smile", animation: "Talking_1" }] });
  if (!geminiApiKey) return res.send({ messages: [{ text: "Tolong tambahkan API key Gemini terlebih dahulu ya.", facialExpression: "angry", animation: "Angry" }] });

  const persona = activePersona;
  const prompt = fillTemplate(promptTemplate, { ...persona, userMessage });

  try {
    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const geminiData = await geminiRes.json();
    let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    rawText = rawText.replace(/```json|```/g, "").trim();
    let messages = JSON.parse(rawText);

    const validExpressions = ["smile", "sad", "angry", "surprised", "funnyFace", "default"];
    const validAnimations = ["Talking_0","Talking_1","Talking_2","Crying","Laughing","Rumba","Idle","Terrified","Angry"];

    messages = messages.map(m => ({
      ...m,
      facialExpression: validExpressions.includes(m.facialExpression) ? m.facialExpression : "default",
      animation: validAnimations.includes(m.animation) ? m.animation : "Idle",
    }));

    if (session_id) {
      await supabase.from("session_transcripts").insert([{ session_id, message_role: "user", message_text: userMessage }]);
      for (const msg of messages)
        await supabase.from("session_transcripts").insert([{ session_id, message_role: "assistant", message_text: msg.text }]);
    }

    res.send({ messages });
  } catch (err) {
    console.error("❌ Error handling chat:", err);
    res.send({ messages: [{ text: "Maaf, terjadi kesalahan. Bisakah kamu ulangi?", facialExpression: "default", animation: "Idle" }] });
  }
});

app.get("/session/:session_id/transcripts", async (req, res) => {
  const { session_id } = req.params;
  const { data, error } = await supabase.from("session_transcripts").select("*").eq("session_id", session_id).order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// buat session baru (optionally with user_id)
app.post("/start-session", async (req, res) => {
  try {
    const { user_id, scenario_id } = req.body; // user_id optional
    const { data, error } = await supabase
      .from("sessions")
      .insert([{ user_id: user_id || null, scenario_id: scenario_id || null, status: "active" }])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, session: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/end-session/:session_id", async (req, res) => {
  try {
    const { session_id } = req.params;
    const { data, error } = await supabase
      .from("sessions")
      .update({ status: "finished", end_time: new Date().toISOString() })
      .eq("id", session_id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, session: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});
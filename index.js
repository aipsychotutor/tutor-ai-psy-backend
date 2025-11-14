import { exec } from "child_process";
import cors from "cors";
import {
  GEMINI_API_URL,
  geminiApiKey,
  elevenLabsApiKey,
  voiceID,
} from "./constant.js";
import express from "express";
import { promises as fs } from "fs";
import axios from "axios";
import { supabase } from "./supabase.js";
import dotenv from "dotenv";
dotenv.config();

// Routes
import authRoutes from "./routes/auth.js";
import patientRoutes from "./routes/patients.js";
import sessionsRoutes from "./routes/sessions.js";
import reportsRoutes from "./routes/reports.js";

// Middleware
import authMiddleware from "./middleware/authMiddleware.js";

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

// ========== PERSONA SYSTEM ==========
const sessionPersonas = new Map();

const personaMaya = {
  nama_pasien: "Maya (Josephine Elsje Basudara)",
  biodata: `- Usia: 25 tahun
- Jenis Kelamin: Perempuan
- Pekerjaan: Pemilik Bisnis Boneka Labubu
- Status: Lajang`,
  latar_belakang_cerita: `Saya merintis usaha boneka Labubu sejak 5 tahun lalu. Awalnya bisnis berjalan lancar, tapi belakangan ini saya merasa kewalahan. Permintaan pasar menurun dan kompetitor bertambah.`,
  kepribadian: `- Kreatif dan detail-oriented.
- Perfeksionis, sulit mendelegasikan tugas.
- Emosional dan sangat terikat dengan hasil karya.`,
};

const promptTemplate = `
Anda berperan sebagai seorang pasien bernama {{nama_pasien}} yang sedang berkonsultasi dengan psikolog.

---
### PROFIL PASIEN

**Biodata:**
{{biodata}}

**Latar Belakang Cerita:**
{{latar_belakang_cerita}}

**Kepribadian:**
{{kepribadian}}
---

Jawablah setiap pertanyaan atau pernyataan psikolog secara alami.

⚠️ Aturan Output:
1. Jawaban HARUS berupa JSON array valid TANPA teks tambahan.
2. Format:
   { "text": "...", "facialExpression": "...", "animation": "..." }
3. facialExpression: ["smile","sad","angry","surprised","funnyFace","default"]
4. animation: ["Talking_0","Talking_1","Talking_2","Crying","Laughing","Rumba","Idle","Terrified","Angry"]

User: {{userMessage}}
`;
// // 💾 Variabel untuk menyimpan persona aktif (dalam memori)
let activePersona = personaMaya;

function fillTemplate(template, data) {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ========== HELPER FUNCTIONS ==========
const execCommand = (cmd) =>
  new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(err);
      resolve(stdout || stderr);
    });
  });

const lipSyncMessage = async (i) => {
  const start = Date.now();
  await execCommand(
    `ffmpeg -y -i audios/message_${i}.mp3 audios/message_${i}.wav`
  );
  console.log(
    `🎵 Converted message_${i}.mp3 -> .wav (${Date.now() - start}ms)`
  );

  await execCommand(
    `bin\\rhubarb.exe -f json -o audios/message_${i}.json audios/message_${i}.wav -r phonetic`
  );
  console.log(`👄 Lip sync done for message_${i} (${Date.now() - start}ms)`);
};

function getVoiceSettings(expression) {
  const settings = {
    smile: { stability: 0.8, similarity_boost: 0.75 },
    sad: { stability: 0.6, similarity_boost: 0.8 },
    angry: { stability: 0.4, similarity_boost: 0.7 },
    surprised: { stability: 0.5, similarity_boost: 0.75 },
    default: { stability: 0.75, similarity_boost: 0.75 },
  };
  return settings[expression] || settings.default;
}

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};
const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

// ========== PERSONA LOADER ==========
async function getPersonaForSession(session_id) {
  if (sessionPersonas.has(session_id)) return sessionPersonas.get(session_id);

  const { data: session, error } = await supabase
    .from("sessions")
    .select(
      `
      patient_id,
      patients (
        patient_name,
        age,
        gender,
        occupation,
        marital_status,
        background_story,
        personality_traits
      )
    `
    )
    .eq("session_id", session_id)
    .single();

  if (error || !session?.patients) {
    console.warn("⚠️ Using default persona");
    return personaMaya;
  }

  const p = session.patients;
  const persona = {
    nama_pasien: p.patient_name,
    biodata: `- Usia: ${p.age || "Tidak diketahui"} tahun
- Jenis Kelamin: ${p.gender || "Tidak diketahui"}
- Pekerjaan: ${p.occupation || "Tidak diketahui"}
- Status: ${p.marital_status || "Tidak diketahui"}`,
    latar_belakang_cerita:
      p.background_story || "Tidak ada latar belakang diketahui",
    kepribadian: Array.isArray(p.personality_traits)
      ? p.personality_traits.map((t) => `- ${t}`).join("\n")
      : "- Tidak terdefinisi",
  };

  sessionPersonas.set(session_id, persona);
  return persona;
}

// ========== ROUTES ==========
app.get("/", (req, res) => res.send("Hello World!"));

// Cek sesi
app.get("/session/:session_id", async (req, res) => {
  const { session_id } = req.params;
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("session_id", session_id)
    .single();

  if (error && error.code !== "PGRST116")
    return res.status(500).json({ error: error.message });
  if (!data)
    return res
      .status(404)
      .json({ exists: false, message: "Session tidak ditemukan" });
  res.json({ exists: true, session: data });
});

// Ambil persona
app.get("/persona/:session_id", async (req, res) => {
  try {
    const persona = await getPersonaForSession(req.params.session_id);
    res.json({ success: true, persona });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ========== CHAT ROUTE ==========
app.post("/chat", async (req, res) => {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 [CHAT] New chat request received");
  console.log("=".repeat(70));

  const { message: userMessage, session_id } = req.body;
  console.log("📥 [INPUT] User Message:", userMessage);
  console.log("📥 [INPUT] Session ID:", session_id);

  // ========== VALIDATION ==========
  if (!userMessage) {
    console.log(
      "⚠️ [VALIDATION] No message provided, returning default greeting"
    );
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
  console.log("✅ [VALIDATION] All checks passed");

  try {
    // ========== GET PERSONA ==========
    console.log("\n📝 [PERSONA] Fetching persona for session...");
    const persona = await getPersonaForSession(session_id);
    console.log("✅ [PERSONA] Retrieved:", JSON.stringify(persona, null, 2));

    // ========== BUILD PROMPT ==========
    console.log("\n🔨 [PROMPT] Building prompt from template...");
    const prompt = fillTemplate(promptTemplate, { ...persona, userMessage });
    console.log("✅ [PROMPT] Generated prompt (first 200 chars):");
    console.log("   ", prompt.substring(0, 200) + "...");

    // ========== CALL GEMINI API ==========
    console.log("\n🤖 [GEMINI] Calling Gemini API...");
    const geminiStartTime = Date.now();

    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const geminiDuration = Date.now() - geminiStartTime;
    console.log(`✅ [GEMINI] Response received in ${geminiDuration}ms`);
    console.log("   Status:", geminiRes.status, geminiRes.statusText);

    if (!geminiRes.ok) {
      console.error("❌ [GEMINI] API returned error status");
      const errorText = await geminiRes.text();
      console.error("   Error response:", errorText);
      throw new Error(`Gemini API error: ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    console.log(
      "📦 [GEMINI] Raw response:",
      JSON.stringify(geminiData, null, 2)
    );

    // ========== PARSE RESPONSE ==========
    console.log("\n🔍 [PARSE] Extracting text from Gemini response...");
    let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    console.log("📄 [PARSE] Raw text before cleaning:");
    console.log("   ", rawText.substring(0, 300));

    rawText = rawText.replace(/```json|```/g, "").trim();
    console.log("📄 [PARSE] Cleaned text:");
    console.log("   ", rawText.substring(0, 300));

    let messages;
    try {
      console.log("🔄 [PARSE] Attempting to parse JSON...");
      messages = JSON.parse(rawText);
      console.log("✅ [PARSE] Successfully parsed JSON");
      console.log("   Number of messages:", messages.length);
      console.log("   Messages:", JSON.stringify(messages, null, 2));
    } catch (parseError) {
      console.error("❌ [PARSE] JSON parse failed:", parseError.message);
      console.error("   Failed text:", rawText);
      messages = [
        {
          text: "Maaf, terjadi kesalahan membaca respons AI.",
          facialExpression: "default",
          animation: "Idle",
        },
      ];
      console.log("⚠️ [PARSE] Using fallback message");
    }

    // ========== VALIDATE EXPRESSIONS ==========
    console.log("\n✔️ [VALIDATE] Validating expressions and animations...");
    const validExpressions = [
      "smile",
      "sad",
      "angry",
      "surprised",
      "funnyFace",
      "default",
    ];
    const validAnimations = [
      "Talking_0",
      "Talking_1",
      "Talking_2",
      "Crying",
      "Laughing",
      "Rumba",
      "Idle",
      "Terrified",
      "Angry",
    ];

    const originalMessages = JSON.parse(JSON.stringify(messages));
    messages = messages.map((m, idx) => {
      const validatedExpression = validExpressions.includes(m.facialExpression)
        ? m.facialExpression
        : "default";
      const validatedAnimation = validAnimations.includes(m.animation)
        ? m.animation
        : "Idle";

      if (
        validatedExpression !== m.facialExpression ||
        validatedAnimation !== m.animation
      ) {
        console.log(`⚠️ [VALIDATE] Message ${idx} corrected:`);
        console.log(
          `   Expression: ${m.facialExpression} → ${validatedExpression}`
        );
        console.log(`   Animation: ${m.animation} → ${validatedAnimation}`);
      }

      return {
        ...m,
        facialExpression: validatedExpression,
        animation: validatedAnimation,
      };
    });
    console.log("✅ [VALIDATE] All messages validated");

    // ========== GENERATE AUDIO & LIPSYNC ==========
    console.log(
      "\n🎤 [TTS] Starting audio generation for",
      messages.length,
      "messages..."
    );

    for (let i = 0; i < messages.length; i++) {
      console.log(
        `\n--- [TTS] Processing message ${i + 1}/${messages.length} ---`
      );
      const msg = messages[i];
      const file = `audios/message_${i}.mp3`;

      console.log(`📝 [TTS-${i}] Text:`, msg.text);
      console.log(`😊 [TTS-${i}] Expression:`, msg.facialExpression);

      try {
        // Get voice settings
        console.log(`⚙️ [TTS-${i}] Getting voice settings...`);
        const settings = getVoiceSettings(msg.facialExpression);
        console.log(`✅ [TTS-${i}] Voice settings:`, settings);

        // Call ElevenLabs
        console.log(`🔊 [TTS-${i}] Calling ElevenLabs API...`);
        const ttsStartTime = Date.now();

        const resp = await axios.post(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceID}`,
          {
            text: msg.text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: settings.stability ?? 0.7,
              similarity_boost: settings.similarity_boost ?? 0.8,
            },
          },
          {
            headers: {
              Accept: "audio/mpeg",
              "Content-Type": "application/json",
              "xi-api-key": String(elevenLabsApiKey),
            },
            responseType: "arraybuffer",
          }
        );

        const ttsDuration = Date.now() - ttsStartTime;
        console.log(`✅ [TTS-${i}] Audio received in ${ttsDuration}ms`);
        console.log(`   Audio size: ${resp.data.byteLength} bytes`);

        // Save audio file
        console.log(`💾 [TTS-${i}] Saving audio to ${file}...`);
        await fs.writeFile(file, Buffer.from(resp.data));
        console.log(`✅ [TTS-${i}] Audio saved successfully`);

        // Generate lipsync
        console.log(`👄 [LIPSYNC-${i}] Generating lipsync data...`);
        const lipsyncStartTime = Date.now();
        await lipSyncMessage(i);
        const lipsyncDuration = Date.now() - lipsyncStartTime;
        console.log(
          `✅ [LIPSYNC-${i}] Lipsync generated in ${lipsyncDuration}ms`
        );

        // Convert to base64
        console.log(`🔐 [BASE64-${i}] Converting audio to base64...`);
        msg.audio = await audioFileToBase64(file);
        console.log(
          `✅ [BASE64-${i}] Audio converted (length: ${msg.audio.length} chars)`
        );

        // Read lipsync JSON
        console.log(`📖 [LIPSYNC-${i}] Reading lipsync JSON...`);
        msg.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
        console.log(`✅ [LIPSYNC-${i}] Lipsync data loaded`);

        console.log(`✅ [TTS-${i}] Message processing complete!`);
      } catch (err) {
        console.error(`❌ [TTS-${i}] Error occurred:`, err.message);
        console.error(`   Stack:`, err.stack);
        console.error(`   Response data:`, err.response?.data);
        console.error(`   Response status:`, err.response?.status);
        msg.audio = null;
        msg.lipsync = null;
        console.log(`⚠️ [TTS-${i}] Continuing with null audio/lipsync`);
      }
    }

    console.log("\n✅ [TTS] All audio processing complete!");

    // ========== SAVE TO DATABASE ==========
    console.log("\n💾 [DATABASE] Saving transcripts to Supabase...");
    const transcriptsToInsert = [
      { session_id, message_role: "user", message_text: userMessage },
      ...messages.map((m) => ({
        session_id,
        message_role: "assistant",
        message_text: m.text,
      })),
    ];

    console.log(
      "📝 [DATABASE] Inserting",
      transcriptsToInsert.length,
      "records"
    );
    console.log("   Records:", JSON.stringify(transcriptsToInsert, null, 2));

    const { data: dbData, error: dbError } = await supabase
      .from("session_transcripts")
      .insert(transcriptsToInsert);

    if (dbError) {
      console.error("❌ [DATABASE] Insert failed:", dbError);
      throw dbError;
    }

    console.log("✅ [DATABASE] Transcripts saved successfully");
    if (dbData) {
      console.log("   Inserted data:", JSON.stringify(dbData, null, 2));
    }

    // ========== SEND RESPONSE ==========
    console.log("\n📤 [RESPONSE] Sending response to client...");
    console.log("   Success: true");
    console.log("   Number of messages:", messages.length);
    console.log("=".repeat(70));
    console.log("✅ [CHAT] Request completed successfully!");
    console.log("=".repeat(70) + "\n");

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

app.post("/set-persona-from-patient", async (req, res) => {
  try {
    const { patient_id } = req.body;

    if (!patient_id) {
      return res.status(400).json({
        success: false,
        message: "patient_id is required",
      });
    }

    console.log("📋 Fetching patient data for persona:", patient_id);

    const { data: patient, error } = await supabase
      .from("patients")
      .select("*")
      .eq("patient_id", patient_id)
      .single();

    if (error || !patient) {
      console.error("❌ Patient not found:", error);
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    const newPersona = {
      nama_pasien: patient.patient_name,
      biodata: `- Usia: ${patient.age || "Tidak diketahui"} tahun
- Jenis Kelamin: ${patient.gender || "Tidak diketahui"}
- Pekerjaan: ${patient.occupation || "Tidak diketahui"}
- Status: ${patient.marital_status || "Tidak diketahui"}`,
      latar_belakang_cerita:
        patient.background_story || "Tidak ada latar belakang",
      kepribadian: Array.isArray(patient.personality_traits)
        ? patient.personality_traits.map((trait) => `- ${trait}`).join("\n")
        : "- Kepribadian tidak terdefinisi",
    };

    activePersona = newPersona;

    console.log(
      "✅ Persona berhasil diset dari patient:",
      patient.patient_name
    );

    res.json({
      success: true,
      message: "Persona berhasil diset dari data patient",
      activePersona: activePersona,
      patient_id: patient_id,
    });
  } catch (err) {
    console.error("❌ Error setting persona from patient:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ========== TRANSCRIPTS ==========
app.get(
  "/session/:session_id/transcripts",
  authMiddleware,
  async (req, res) => {
    const { session_id } = req.params;
    const user_id = req.user.user_id;
    const { data, error } = await supabase
      .from("session_transcripts")
      .select("*, sessions(user_id)")
      .eq("session_id", session_id)
      .eq("sessions.user_id", user_id)
      .order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) {
      return res.status(404).json({
        message: "Transkrip tidak ditemukan atau Anda tidak punya akses.",
      });
    }
    res.json(data);
  }
);

// ========== SESSION MANAGEMENT ==========
app.post("/start-session", authMiddleware, async (req, res) => {
  const { patient_id } = req.body;
  const user_id = req.user.user_id;
  try {
    const { data, error } = await supabase
      .from("sessions")
      .insert([
        {
          user_id: user_id,
          patient_id: patient_id || null,
          status: "active",
        },
      ])
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, session: data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/end-session/:session_id", authMiddleware, async (req, res) => {
  try {
    const { session_id } = req.params;
    const user_id = req.user.user_id;

    const { data, error } = await supabase
      .from("sessions")
      .update({ status: "finished", end_time: new Date().toISOString() })
      .eq("session_id", session_id)
      .eq("user_id", user_id)
      .select()
      .single();
    if (error) throw error;
    if (!data)
      return res.status(404).json({
        message: "Session tidak ditemukan atau Anda tidak punya akses.",
      });

    res.json({ success: true, session: data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== RUN ==========
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

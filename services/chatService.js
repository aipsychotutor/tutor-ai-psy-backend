import { getPersonaForSession, buildPrompt } from "./personaService.js";
import { callGeminiAPI, parseGeminiResponse, validateMessages, findRelevantContext, getEmbedding } from "./geminiService.js";
import { processMessagesAudio } from "./ttsService.js";
import { saveTranscripts } from "./transcriptService.js";
import { VOICE_FEMALE, VOICE_MALE } from "../constant.js";

// ========== HELPER: MATEMATIKA VECTOR ==========
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ========== MAIN CHAT SERVICE ==========
export async function processChatMessage(userMessage, session_id, prosody_data = null) {
  const tStart = Date.now();
  console.log(`[User Prompt] "${userMessage}"`);

  // 1. GET PERSONA
  const tPersonaStart = Date.now();
  const persona = await getPersonaForSession(session_id);
  const tPersona = Date.now() - tPersonaStart;
  
  const hasPrecomputedData = persona.knowledge_base && Array.isArray(persona.knowledge_base) && persona.knowledge_base.length > 0;
  
  let relevantContext = "";
  const rawKnowledge = [persona.biodata, persona.latar_belakang_cerita, persona.kepribadian].filter(Boolean).join("\n\n");

  // 2. HYBRID RAG LOGIC
  const tRagStart = Date.now();
  if (hasPrecomputedData) {
    // --- FAST RAG (Pre-computed Vectors) ---
    const queryVector = await getEmbedding(userMessage);

    if (queryVector) {
      const scored = persona.knowledge_base.map(item => ({
        text: item.text,
        score: cosineSimilarity(queryVector, item.vector)
      }));

      // Urutkan berdasarkan kemiripan tertinggi
      scored.sort((a, b) => b.score - a.score);
      
      // Ambil top 3 konteks
      const topResults = scored.slice(0, 3);
      relevantContext = topResults.map(s => s.text).join("\n");
    }

  } else {
    // Teks latar belakang pasien sudah padat & terstruktur (< 3000 karakter).
    relevantContext = rawKnowledge;
  }
  const tRag = Date.now() - tRagStart;

  // Gabungkan hasil RAG atau gunakan raw knowledge jika RAG gagal/kosong
  const finalContext = relevantContext || rawKnowledge;

  // Update persona dengan konteks yang disaring agar LLM fokus
  const ragPersona = {
    ...persona,
    latar_belakang_cerita: `
      [INFORMASI KONTEKSTUAL]:
      ${finalContext} 
      (Gunakan informasi di atas sebagai prioritas utama dalam menjawab)
    `
  };

  const prompt = buildPrompt(ragPersona, userMessage);

  // 3. CALL GEMINI API (LLM)
  const tLlmStart = Date.now();
  const geminiData = await callGeminiAPI(prompt, { maxOutputTokens: 500 });
  const tLlm = Date.now() - tLlmStart;

  // 4. PARSE & VALIDATE
  let messages = parseGeminiResponse(geminiData);
  messages = validateMessages(messages);

  // 5. GENERATE AUDIO & LIPSYNC (TTS)
  const genderLower = (persona.gender || "").toLowerCase();
  const isMale =
    genderLower === "laki-laki" ||
    genderLower === "male" ||
    genderLower === "pria" ||
    (persona.biodata && persona.biodata.toLowerCase().includes("laki-laki"));
  const voiceId = isMale ? VOICE_MALE : VOICE_FEMALE;

  const tAudioStart = Date.now();
  messages = await processMessagesAudio(messages, voiceId);
  const tAudio = Date.now() - tAudioStart;

  // 6. SAVE TO DATABASE
  // Tidak menggunakan 'await' agar respons ke user lebih cepat (fire-and-forget)
  saveTranscripts(session_id, userMessage, messages, prosody_data, finalContext)
    .catch(err => console.error(`[DB Error] Failed to save transcript: ${err.message}`));

  const tTotal = Date.now() - tStart;

  // Compute sub-breakdown for TTS and LipSync from messages
  const ttsDurations = messages.map(m => m._timings?.ttsDuration).filter(Boolean);
  const lipDurations = messages.map(m => m._timings?.lipsyncDuration).filter(Boolean);
  const avgTTS = ttsDurations.length ? Math.round(ttsDurations.reduce((a, b) => a + b, 0) / ttsDurations.length) : "N/A";
  const avgLip = lipDurations.length ? Math.round(lipDurations.reduce((a, b) => a + b, 0) / lipDurations.length) : "N/A";

  console.log(`-------------------------------------------------`);
  console.log(`1. Persona Retrieval    : ${tPersona} ms`);
  console.log(`2. RAG & Vector Embed   : ${tRag} ms`);
  console.log(`3. Gemini LLM Gen       : ${tLlm} ms`);
  console.log(`4. ElevenLabs TTS       : ${avgTTS} ms (per-msg)`);
  console.log(`5. LipSync (FFmpeg+Rhu) : ${avgLip} ms (per-msg)`);
  console.log(`6. Total Audio Pipeline : ${tAudio} ms`);
  console.log(`-------------------------------------------------`);
  console.log(`TOTAL BACKEND LATENCY    : ${tTotal} ms (${(tTotal / 1000).toFixed(2)} detik)`);
  console.log(`=================================================\n`);

  // Clean internal metadata before returning to frontend
  messages.forEach(m => { delete m._timings; });

  return messages;
}

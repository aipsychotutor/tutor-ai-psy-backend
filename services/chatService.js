import { getPersonaForSession, buildPrompt } from "./personaService.js";
import { callGeminiAPI, parseGeminiResponse, validateMessages, findRelevantContext, getEmbedding } from "./geminiService.js";
import { processMessagesAudio } from "./ttsService.js";
import { saveTranscripts } from "./transcriptService.js";

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
  // ⏱️ START TIMER GLOBAL
  const startTimeGlobal = Date.now();
  

  // ========== 1. GET PERSONA ==========
  const t0 = Date.now();
  console.log("\n📝 [PERSONA] Fetching persona for session...");
  const persona = await getPersonaForSession(session_id);
  const durationPersona = Date.now() - t0; // Hitung durasi
  
  const hasPrecomputedData = persona.knowledge_base && Array.isArray(persona.knowledge_base) && persona.knowledge_base.length > 0;
  
  let relevantContext = "";
  const rawKnowledge = [persona.biodata, persona.latar_belakang_cerita, persona.kepribadian].filter(Boolean).join("\n\n");

  // ============================================================
  // HYBRID RAG LOGIC
  // ============================================================
  const t1 = Date.now(); // Start Timer RAG
  
  if (hasPrecomputedData) {
    // --- FAST RAG ---
    
    const queryVector = await getEmbedding(userMessage);

    if (queryVector) {
      const scored = persona.knowledge_base.map(item => ({
        text: item.text,
        score: cosineSimilarity(queryVector, item.vector)
      }));

      scored.sort((a, b) => b.score - a.score);
      const topResults = scored.slice(0, 3);
      relevantContext = topResults.map(s => s.text).join("\n");
    }

  } else {
    // --- SLOW RAG (Fallback) ---
    console.log("\n🐢 [RAG - SLOW] No pre-computed vectors. Doing on-the-fly...");
    
    const knowledgeChunks = rawKnowledge
      .split(/\n|\./) 
      .map(s => s.trim())
      .filter(s => s.length > 10); 

    if (knowledgeChunks.length > 0) {
      const ragResult = await findRelevantContext(userMessage, knowledgeChunks, 3);
      if (ragResult) relevantContext = ragResult;
    }
  }
  const durationRAG = Date.now() - t1; // Hitung durasi RAG

  const finalContext = relevantContext || rawKnowledge;

  const ragPersona = {
    ...persona,
    latar_belakang_cerita: `
      [INFORMASI KONTEKSTUAL DARI DATABASE]:
      ${finalContext} 
      (Gunakan informasi di atas sebagai prioritas utama)
    `
  };

  const prompt = buildPrompt(ragPersona, userMessage);

  // ========== 3. CALL GEMINI API (LLM) ==========
  const t2 = Date.now();
  const geminiData = await callGeminiAPI(prompt);
  const durationLLM = Date.now() - t2; // Hitung durasi Gemini

  // ========== 4. PARSE & VALIDATE ==========
  let messages = parseGeminiResponse(geminiData);
  messages = validateMessages(messages);

  // ========== 5. GENERATE AUDIO & LIPSYNC (TTS) ==========
  const t3 = Date.now();
  messages = await processMessagesAudio(messages);
  const durationTTS = Date.now() - t3; // Hitung durasi TTS

  // ========== 6. SAVE TO DATABASE ==========
  const t4 = Date.now();
  saveTranscripts(session_id, userMessage, messages, prosody_data, finalContext);
  const durationDB = 0;

  // ⏱️ HITUNG TOTAL
  const totalDuration = Date.now() - startTimeGlobal;

  // ========== 📊 PERFORMANCE REPORT ==========
  console.log("\n" + "=".repeat(50));
  console.log("⏱️  PERFORMANCE REPORT (TIMING BREAKDOWN)");
  console.log("-".repeat(50));
  console.log(`👤 Persona Fetch : ${durationPersona} ms`);
  console.log(`🧠 RAG Process   : ${durationRAG} ms  ${hasPrecomputedData ? "(⚡ Fast Mode)" : "(🐢 Slow Mode)"}`);
  console.log(`🤖 Gemini (LLM)  : ${durationLLM} ms`);
  console.log(`🔊 TTS & Audio   : ${durationTTS} ms`);
  console.log("-".repeat(50));
  console.log(`🚀 TOTAL TIME    : ${totalDuration} ms (${(totalDuration/1000).toFixed(2)} seconds)`);
  console.log("=".repeat(50) + "\n");

  return messages;
}
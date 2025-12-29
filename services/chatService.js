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
  
  // 1. GET PERSONA
  const persona = await getPersonaForSession(session_id);
  
  const hasPrecomputedData = persona.knowledge_base && Array.isArray(persona.knowledge_base) && persona.knowledge_base.length > 0;
  
  let relevantContext = "";
  const rawKnowledge = [persona.biodata, persona.latar_belakang_cerita, persona.kepribadian].filter(Boolean).join("\n\n");

  // 2. HYBRID RAG LOGIC
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
    // --- SLOW RAG (Fallback / On-the-fly) ---
    // Memecah teks panjang menjadi potongan kalimat/paragraf
    const knowledgeChunks = rawKnowledge
      .split(/\n|\./) 
      .map(s => s.trim())
      .filter(s => s.length > 10); 

    if (knowledgeChunks.length > 0) {
      const ragResult = await findRelevantContext(userMessage, knowledgeChunks, 3);
      if (ragResult) relevantContext = ragResult;
    }
  }

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
  const geminiData = await callGeminiAPI(prompt);

  // 4. PARSE & VALIDATE
  let messages = parseGeminiResponse(geminiData);
  messages = validateMessages(messages);

  // 5. GENERATE AUDIO & LIPSYNC (TTS)
  messages = await processMessagesAudio(messages);

  // 6. SAVE TO DATABASE
  // Tidak menggunakan 'await' agar respons ke user lebih cepat (fire-and-forget)
  saveTranscripts(session_id, userMessage, messages, prosody_data, finalContext)
    .catch(err => console.error(`[DB Error] Failed to save transcript: ${err.message}`));

  return messages;
}
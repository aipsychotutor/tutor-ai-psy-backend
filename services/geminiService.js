import {geminiApiKey } from "../constant.js";

const MODEL_FAST = "gemini-2.5-flash-lite"; 
const MODEL_STABLE = "gemini-2.0-flash-001";

// ========== VALIDATION ==========
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

// Fungsi pembantu untuk fetch ke Gemini
async function requestToGemini(prompt, modelName, signal = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: signal // Untuk fitur timeout/abort
  });

  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}
// ========== HELPER FUNCTIONS ==========
function validateMessage(message) {
  const validatedExpression = validExpressions.includes(message.facialExpression)
    ? message.facialExpression
    : "default";
  
  const validatedAnimation = validAnimations.includes(message.animation)
    ? message.animation
    : "Idle";

  return {
    ...message,
    facialExpression: validatedExpression,
    animation: validatedAnimation,
  };
}

// Switch Model
export async function callGeminiAPI(prompt) {
  let responseJson;
  const startTime = Date.now();

  try {
    // USAHA 1: MODEL FLASH (Prioritas Kecepatan)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    responseJson = await requestToGemini(prompt, MODEL_FAST, controller.signal);

    clearTimeout(timeoutId);

  } catch (err) {
    // FAILOVER: MODEL PRO (Prioritas Stabilitas)
    console.warn(`[Gemini] Fast model failed or timed out. Switching to Stable model. Reason: ${err.message}`);

    try {
      responseJson = await requestToGemini(prompt, MODEL_STABLE);
    } catch (errPro) {
      console.error("[Gemini] CRITICAL FAILURE: Both models failed.");
      console.error(`Error Flash: ${err.message}`);
      console.error(`Error Pro: ${errPro.message}`);
      
      throw new Error(`AI Overload. Flash: [${err.message}] || Pro: [${errPro.message}]`);
    }
  }

  return responseJson;
}

export function parseGeminiResponse(geminiData) {
  let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

  rawText = rawText.replace(/```json|```/g, "").trim();

  let messages = [];
  try {
    const parsedData = JSON.parse(rawText);

    if (Array.isArray(parsedData)) {
      messages = parsedData;
    } else if (typeof parsedData === 'object' && parsedData !== null) {
      // Jika Object, bungkus jadi Array [Object]
      messages = [parsedData];
    } else {
      throw new Error("JSON format not recognized (Not Array/Object)");
    }

  } catch (parseError) {
    console.error("[Gemini Parse] Failed to parse JSON:", parseError.message);
    
    // Fallback agar server tidak crash
    messages = [
      {
        text: "Maaf, saya sedikit bingung dengan respon sistem.",
        facialExpression: "sad",
        animation: "Idle",
      },
    ];
  }

  return messages;
}

export function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    console.error("[Validate] Input is not an array. Returning empty.");
    return [];
  }
  const validatedMessages = messages.map((m) => validateMessage(m));
  return validatedMessages;
}

// 1. Mengambil Vector (Angka) dari Teks
export async function getEmbedding(text) {
  // Pengecekan aman agar tidak mengirim string kosong
  if (!text || typeof text !== "string" || text.trim() === "") {
    console.warn("[Embedding] Empty or invalid text provided. Skipping.");
    return null;
  }

  const EMBEDDING_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent";

  try {
    const response = await fetch(`${EMBEDDING_URL}?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          parts: [{ text: text }]
        }
      })
    });

    if (!response.ok) {
      const errorDetails = await response.text(); 
      throw new Error(`HTTP ${response.status} - Details: ${errorDetails}`);
    }

    const data = await response.json();
    return data.embedding.values;

  } catch (error) {
    console.error(`[Embedding] Failed to generate vector: ${error.message}`);
    return null;
  }
}
// 2. Menghitung Kemiripan (Cosine Similarity)
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 3. Fungsi UTAMA RAG
export async function findRelevantContext(userQuery, contextList, topK = 3) {
  // a. Vectorkan pertanyaan user
  const queryVector = await getEmbedding(userQuery);
  if (!queryVector) {
    return "";
  }

  // b. Bandingkan dengan Knowledge Base
  const scoredContexts = await Promise.all(
    contextList.map(async (item) => {
      const textContent = typeof item === 'string' ? item : item.text || JSON.stringify(item);

      // Generate vector
      const itemVector = await getEmbedding(textContent);

      // Hitung skor
      const score = cosineSimilarity(queryVector, itemVector);

      return { text: textContent, score: score };
    })
  );

  // c. Urutkan dari skor tertinggi
  scoredContexts.sort((a, b) => b.score - a.score);

  // d. Ambil top K
  const topResults = scoredContexts.slice(0, topK);

  return topResults.map(r => r.text).join("\n");
}
import {geminiApiKey } from "../constant.js";

const MODEL_FAST = "gemini-2.5-flash"; 
const MODEL_STABLE = "gemini-2.5-pro";

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

// Fungsi pembantu untuk fetch ke Gemini biar kodingan utama rapi
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
function validateMessage(message, idx) {
  const validatedExpression = validExpressions.includes(message.facialExpression)
    ? message.facialExpression
    : "default";
  const validatedAnimation = validAnimations.includes(message.animation)
    ? message.animation
    : "Idle";

  if (
    validatedExpression !== message.facialExpression ||
    validatedAnimation !== message.animation
  ) {
    console.log(`⚠️ [VALIDATE] Message ${idx} corrected:`);
    console.log(
      `   Expression: ${message.facialExpression} → ${validatedExpression}`
    );
    console.log(`   Animation: ${message.animation} → ${validatedAnimation}`);
  }

  return {
    ...message,
    facialExpression: validatedExpression,
    animation: validatedAnimation,
  };
}

// ========== SERVICE METHODS ==========
/* Retry
export async function callGeminiAPI(prompt) {
  const maxRetries = 3;
  const retryDelay = 2000;
  let geminiRes;
  let geminiDuration;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `\n🤖 [GEMINI] Calling Gemini API (Attempt ${attempt}/${maxRetries})...`
    );
    const geminiStartTime = Date.now();

    try {
      geminiRes = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      geminiDuration = Date.now() - geminiStartTime;
      console.log(`✅ [GEMINI] Response received in ${geminiDuration}ms`);
      console.log("   Status:", geminiRes.status, geminiRes.statusText);

      if (geminiRes.ok) {
        break;
      }

      if (geminiRes.status === 503) {
        console.warn(`[GEMINI] Received 503 (Service Unavailable).`);
        if (attempt < maxRetries) {
          console.warn(`   Waiting ${retryDelay}ms before retrying...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        } else {
          console.error(`[GEMINI] Max retries reached. Failing.`);
        }
      } else {
        console.warn(
          `[GEMINI] Received non-retryable error ${geminiRes.status}.`
        );
        break;
      }
    } catch (fetchError) {
      console.error(
        `❌ [GEMINI] Fetch error on attempt ${attempt}:`,
        fetchError.message
      );
      geminiRes = {
        ok: false,
        status: 500,
        statusText: fetchError.message,
        text: async () => fetchError.message,
      };

      if (attempt < maxRetries) {
        console.warn(`   Waiting ${retryDelay}ms before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  if (!geminiRes.ok) {
    console.error("❌ [GEMINI] API call failed after all retries");
    const errorText = await geminiRes
      .text()
      .catch(() => "Could not read error text");
    console.error("   Error response:", errorText);
    throw new Error(
      `Gemini API error: ${geminiRes.status} ${geminiRes.statusText}`
    );
  }

  return await geminiRes.json();
}
*/

// Switch Model
export async function callGeminiAPI(prompt) {
  let responseJson;
  const startTime = Date.now();

  try {
    // 🏎️ USAHA 1: MODEL FLASH (Prioritas Kecepatan)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); 

    console.log(`🤖 [GEMINI] Attempt 1: ${MODEL_FAST} (Speed Mode)`);
    
    responseJson = await requestToGemini(prompt, MODEL_FAST, controller.signal);
    
    clearTimeout(timeoutId); 
    console.log(`✅ [GEMINI] Flash responded in ${Date.now() - startTime}ms`);

  } catch (err) {
    // 🛡️ FAILOVER: MODEL PRO (Prioritas Stabilitas)
    const timeWasted = Date.now() - startTime;
    console.warn(`⚠️ [GEMINI] Flash Failed/Timeout (${timeWasted}ms).`);
    console.warn(`   Reason 1: ${err.message}`);
    console.log(`🛡️ [GEMINI] Instant Switch to: ${MODEL_STABLE}...`);

    try {
      responseJson = await requestToGemini(prompt, MODEL_STABLE);
      console.log(`✅ [GEMINI] Pro rescued the chat!`);
      
    } catch (errPro) {
      console.error("\n🔥 [GEMINI] CRITICAL FAILURE: Both models failed.");
      
      // 1. Log Error Flash 
      console.error(`   📉 Error 1 (Flash): ${err.message}`);
      
      // 2. Log Error Pro 
      console.error(`   📉 Error 2 (Pro)  : ${errPro.message}`);
      
      if(errPro.cause) console.error("   🔎 Cause:", errPro.cause);

      throw new Error(`AI Overload. Flash: [${err.message}] || Pro: [${errPro.message}]`);
    }
  }

  // --- 📊 DEBUG TOKEN USAGE ---
  if (responseJson && responseJson.usageMetadata) {
    const { promptTokenCount, candidatesTokenCount } = responseJson.usageMetadata;
    console.log(`💰 [TOKEN] In: ${promptTokenCount} | Out: ${candidatesTokenCount}`);
  }

  return responseJson;
}

export function parseGeminiResponse(geminiData) {
  let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

  rawText = rawText.replace(/```json|```/g, "").trim();


  let messages =[];
  try {
    const parsedData = JSON.parse(rawText);

    if (Array.isArray(parsedData)) {
      // Jika Array, langsung pakai
      messages = parsedData;
    } else if (typeof parsedData === 'object' && parsedData !== null) {
      // Jika Object, bungkus jadi Array [Object]
      console.warn("⚠️ [PARSE] Gemini returned Single Object, wrapping in Array.");
      messages = [parsedData];
    } else {
      // Jika bukan keduanya, anggap error
      throw new Error("Format JSON tidak dikenali (Bukan Array/Object)");
    }

    console.log(`✅ [PARSE] JSON OK. ${messages.length} messages.`);
    
  } catch (parseError) {
    console.error("❌ [PARSE] Failed:", parseError.message);
    console.error("   Raw Text:", rawText.substring(0, 100) + "...");
    
    // Fallback agar server tidak crash
    messages = [
      {
        text: "Maaf, saya sedikit bingung.",
        facialExpression: "sad",
        animation: "Idle",
      },
    ];
  }

  return messages;
}

export function validateMessages(messages) {
  
  if (!Array.isArray(messages)) {
    console.error("❌ [VALIDATE] Input is not an array! Returning empty.");
    return [];
  }
  const validatedMessages = messages.map((m, idx) => validateMessage(m, idx));
  return validatedMessages;
}

// 1. Mengambil Vector (Angka) dari Teks
export async function getEmbedding(text) {
  // Truncate text for logging biar terminal gak penuh 
  const shortText = text.length > 40 ? text.substring(0, 40) + "..." : text;

  const EMBEDDING_URL = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
  
  try {
    const response = await fetch(`${EMBEDDING_URL}?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: {
          parts: [{ text: text }]
        }
      })
    });

    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const data = await response.json();
    const vector = data.embedding.values;
    
    return vector;

  } catch (error) {
    console.error(`   ❌ [EMBEDDING] Failed for "${shortText}":`, error.message);
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

// 3. Fungsi UTAMA yang akan dipanggil dari luar
// userQuery: Pertanyaan user (String)
// contextList: Array of Strings ["Pasien sakit X", "Riwayat Y"] atau Objects
export async function findRelevantContext(userQuery, contextList, topK = 3) {
  // a. Vectorkan pertanyaan user
  console.log("⏳ [RAG] Vectorizing User Query...");
  const queryVector = await getEmbedding(userQuery);
  if (!queryVector) {
    console.log("❌ [RAG] Failed to vectorize query. Returning empty context.");
    return "";
  }

  console.log("⏳ [RAG] Comparing against Knowledge Base...");
  const scoredContexts = await Promise.all(
    contextList.map(async (item, index) => {
      const textContent = typeof item === 'string' ? item : item.text || JSON.stringify(item);
      
      // Generate vector (Idealnya ini sudah di-cache di DB)
      const itemVector = await getEmbedding(textContent);
      
      // Hitung skor
      const score = cosineSimilarity(queryVector, itemVector);
      
      // DEBUG PER ITEM (Opsional: matikan jika terlalu berisik)
      const shortContent = textContent.substring(0, 50).replace(/\n/g, " ");
      console.log(`   🔹 [Item ${index}] Score: ${score.toFixed(4)} | "${shortContent}..."`);
      
      return { text: textContent, score: score };
    })
  );

  // c. Urutkan dari skor tertinggi (Paling Mirip)
  scoredContexts.sort((a, b) => b.score - a.score);

  // d. Ambil top K (misal: 3 fakta teratas)
  const topResults = scoredContexts.slice(0, topK);

  return topResults.map(r => r.text).join("\n");
}
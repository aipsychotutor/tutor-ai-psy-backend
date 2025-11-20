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
    // Kita pasang TIMEOUT 8 Detik. Kalau Flash loading kelamaan (hang), kita anggap gagal.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); 

    console.log(`🤖 [GEMINI] Attempt 1: ${MODEL_FAST} (Speed Mode)`);
    
    responseJson = await requestToGemini(prompt, MODEL_FAST, controller.signal);
    
    clearTimeout(timeoutId); // Hapus timer kalau sukses
    console.log(`✅ [GEMINI] Flash responded in ${Date.now() - startTime}ms`);

  } catch (err) {
    // 🛡️ FAILOVER: MODEL PRO (Prioritas Stabilitas)
    // Jika Flash Error (503) ATAU Timeout (Hang), langsung masuk sini.
    const timeWasted = Date.now() - startTime;
    console.warn(`⚠️ [GEMINI] Flash Failed/Timeout (${timeWasted}ms). Reason: ${err.message}`);
    console.log(`🛡️ [GEMINI] Instant Switch to: ${MODEL_STABLE}...`);

    try {
      // Langsung tembak PRO tanpa delay/retry!
      responseJson = await requestToGemini(prompt, MODEL_STABLE);
      console.log(`✅ [GEMINI] Pro rescued the chat!`);
    } catch (errPro) {
      console.error("❌ [GEMINI] Both models failed.");
      throw new Error("Maaf, AI sedang sibuk. Coba lagi nanti.");
    }
  }

  // --- 📊 DEBUG TOKEN USAGE ---
  if (responseJson.usageMetadata) {
    const { promptTokenCount, candidatesTokenCount } = responseJson.usageMetadata;
    console.log(`💰 [TOKEN] In: ${promptTokenCount} | Out: ${candidatesTokenCount}`);
  }

  return responseJson;
}

export function parseGeminiResponse(geminiData) {
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

  return messages;
}

export function validateMessages(messages) {
  console.log("\n✔️ [VALIDATE] Validating expressions and animations...");
  const validatedMessages = messages.map((m, idx) => validateMessage(m, idx));
  console.log("✅ [VALIDATE] All messages validated");
  return validatedMessages;
}

// 1. Mengambil Vector (Angka) dari Teks
export async function getEmbedding(text) {
  // Truncate text for logging biar terminal gak penuh 
  const shortText = text.length > 40 ? text.substring(0, 40) + "..." : text;
  // console.log(`   🔌 [EMBEDDING] Requesting vector for: "${shortText}"`);

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
  console.log("\n" + "=".repeat(60));
  console.log("🧠 [RAG START] Searching Knowledge Base");
  console.log(`❓ User Query: "${userQuery}"`);
  console.log(`📚 Total Candidates: ${contextList.length} items`);
  console.log("-".repeat(60));

  // a. Vectorkan pertanyaan user
  console.log("⏳ [RAG] Vectorizing User Query...");
  const queryVector = await getEmbedding(userQuery);
  if (!queryVector) {
    console.log("❌ [RAG] Failed to vectorize query. Returning empty context.");
    return "";
  }
  // b. Hitung skor untuk setiap potongan data (Fakta)
  // NOTE: Idealnya contextList sudah punya vector di database biar cepat.
  // Tapi untuk sekarang kita generate on-the-fly.

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

  console.log("-".repeat(60));
  console.log(`🏆 [RAG WINNERS] Top ${topK} Most Relevant Contexts:`);
  topResults.forEach((r, i) => {
    console.log(`   ${i+1}. [Score: ${r.score.toFixed(4)}] "${r.text.substring(0, 100)}..."`);
  });
  console.log("=".repeat(60) + "\n");

  return topResults.map(r => r.text).join("\n");
}
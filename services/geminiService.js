import { GEMINI_API_URL, geminiApiKey } from "../constant.js";

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
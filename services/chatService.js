import { getPersonaForSession, buildPrompt } from "./personaService.js";
import { callGeminiAPI, parseGeminiResponse, validateMessages } from "./geminiService.js";
import { processMessagesAudio } from "./ttsService.js";
import { saveTranscripts } from "./transcriptService.js";

// ========== MAIN CHAT SERVICE ==========
export async function processChatMessage(userMessage, session_id, prosody_data = null) {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 [CHAT] Processing chat message");
  console.log("=".repeat(70));
  console.log("📥 [INPUT] User Message:", userMessage);
  console.log("📥 [INPUT] Session ID:", session_id);
  console.log("📥 [INPUT] Prosody Data:", prosody_data);

  // ========== GET PERSONA ==========
  console.log("\n📝 [PERSONA] Fetching persona for session...");
  const persona = await getPersonaForSession(session_id);
  console.log("✅ [PERSONA] Retrieved:", JSON.stringify(persona, null, 2));

  // ========== BUILD PROMPT ==========
  console.log("\n🔨 [PROMPT] Building prompt from template...");
  const prompt = buildPrompt(persona, userMessage);
  console.log("✅ [PROMPT] Generated prompt (first 200 chars):");
  console.log("   ", prompt.substring(0, 200) + "...");

  // ========== CALL GEMINI API ==========
  const geminiData = await callGeminiAPI(prompt);
  console.log("📦 [GEMINI] Raw response:", JSON.stringify(geminiData, null, 2));

  // ========== PARSE & VALIDATE ==========
  let messages = parseGeminiResponse(geminiData);
  messages = validateMessages(messages);

  // ========== GENERATE AUDIO & LIPSYNC ==========
  messages = await processMessagesAudio(messages);

  // ========== SAVE TO DATABASE ==========
  await saveTranscripts(session_id, userMessage, messages, prosody_data);

  // ========== RETURN RESULT ==========
  console.log("\n📤 [RESPONSE] Chat processing completed");
  console.log("   Number of messages:", messages.length);
  console.log("=".repeat(70) + "\n");

  return messages;
}
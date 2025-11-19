import { exec } from "child_process";
import { promises as fs } from "fs";
import axios from "axios";
import { elevenLabsApiKey, voiceID } from "../constant.js";

// ========== HELPER FUNCTIONS ==========
const execCommand = (cmd) =>
  new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(err);
      resolve(stdout || stderr);
    });
  });

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

// ========== SERVICE METHODS ==========
export async function generateLipSync(messageIndex) {
  const start = Date.now();
  await execCommand(
    `ffmpeg -y -i audios/message_${messageIndex}.mp3 audios/message_${messageIndex}.wav`
  );
  console.log(
    `🎵 Converted message_${messageIndex}.mp3 -> .wav (${Date.now() - start}ms)`
  );

  await execCommand(
    `bin\\rhubarb.exe -f json -o audios/message_${messageIndex}.json audios/message_${messageIndex}.wav -r phonetic`
  );
  console.log(
    `👄 Lip sync done for message_${messageIndex} (${Date.now() - start}ms)`
  );
}

export async function generateTTS(text, expression) {
  const settings = getVoiceSettings(expression);

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceID}`,
    {
      text: text,
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

  return Buffer.from(response.data);
}

export async function processMessagesAudio(messages) {
  console.log(
    "\n🎤 [TTS] Starting audio generation for",
    messages.length,
    "messages..."
  );

  for (let i = 0; i < messages.length; i++) {
    console.log(`\n--- [TTS] Processing message ${i + 1}/${messages.length} ---`);
    const msg = messages[i];
    const file = `audios/message_${i}.mp3`;

    console.log(`📝 [TTS-${i}] Text:`, msg.text);
    console.log(`😊 [TTS-${i}] Expression:`, msg.facialExpression);

    try {
      console.log(`🔊 [TTS-${i}] Calling ElevenLabs API...`);
      const ttsStartTime = Date.now();

      const audioBuffer = await generateTTS(msg.text, msg.facialExpression);

      const ttsDuration = Date.now() - ttsStartTime;
      console.log(`✅ [TTS-${i}] Audio received in ${ttsDuration}ms`);
      console.log(`   Audio size: ${audioBuffer.byteLength} bytes`);

      console.log(`💾 [TTS-${i}] Saving audio to ${file}...`);
      await fs.writeFile(file, audioBuffer);
      console.log(`✅ [TTS-${i}] Audio saved successfully`);

      console.log(`👄 [LIPSYNC-${i}] Generating lipsync data...`);
      const lipsyncStartTime = Date.now();
      await generateLipSync(i);
      const lipsyncDuration = Date.now() - lipsyncStartTime;
      console.log(
        `✅ [LIPSYNC-${i}] Lipsync generated in ${lipsyncDuration}ms`
      );

      console.log(`🔐 [BASE64-${i}] Converting audio to base64...`);
      msg.audio = await audioFileToBase64(file);
      console.log(
        `✅ [BASE64-${i}] Audio converted (length: ${msg.audio.length} chars)`
      );

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
  return messages;
}
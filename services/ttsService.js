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

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

// ========== SERVICE METHODS ==========
export async function generateLipSync(messageIndex) {
  // 1. Convert MP3 to WAV (FFmpeg)
  await execCommand(
    `ffmpeg -y -i audios/message_${messageIndex}.mp3 audios/message_${messageIndex}.wav`
  );
  
  // 2. Generate JSON (Rhubarb)
  // Pastikan path 'bin/rhubarb.exe' sesuai dengan struktur folder project Anda
  await execCommand(
    `bin\\rhubarb.exe -f json -o audios/message_${messageIndex}.json audios/message_${messageIndex}.wav -r phonetic`
  );
}

export async function generateTTS(text, expression) {
  const settings = getVoiceSettings(expression);
  
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceID}`,
    {
      text: text,
      model_id: "eleven_turbo_v2_5", 
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
      timeout: 15000 // Timeout 15s
    }
  );

  return Buffer.from(response.data);
}

// FUNGSI PROSES PER-ITEM
async function processSingleMessage(msg, i) {
  const file = `audios/message_${i}.mp3`;
  
  try {
    // 1. Request TTS
    const audioBuffer = await generateTTS(msg.text, msg.facialExpression);
    
    // 2. Convert Base64 (In-Memory for Frontend)
    msg.audio = audioBuffer.toString("base64");

    // 3. Save to Disk (Required for LipSync tool)
    await fs.writeFile(file, audioBuffer);

    // 4. Generate LipSync
    await generateLipSync(i);

    // 5. Read Result
    msg.lipsync = await readJsonTranscript(`audios/message_${i}.json`);

    return msg;

  } catch (err) {
    console.error(`[TTS Service] Message ${i} failed: ${err.message}`);
    msg.audio = null;
    msg.lipsync = null;
    return msg;
  }
}

// FUNGSI UTAMA (PARALLEL)
export async function processMessagesAudio(messages) {
  // Jalankan semua proses secara paralel
  await Promise.all(
    messages.map((msg, index) => processSingleMessage(msg, index))
  );
  
  return messages;
}
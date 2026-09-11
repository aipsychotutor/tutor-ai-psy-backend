import { exec } from "child_process";
import { promises as fs } from "fs";
import axios from "axios";
import ffmpegPath from "ffmpeg-static";
import { elevenLabsApiKey, VOICE_FEMALE, VOICE_MALE } from "../constant.js";

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
    smile: { stability: 0.38, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
    sad: { stability: 0.32, similarity_boost: 0.85, style: 0.45, use_speaker_boost: true },
    angry: { stability: 0.28, similarity_boost: 0.75, style: 0.50, use_speaker_boost: true },
    surprised: { stability: 0.35, similarity_boost: 0.80, style: 0.40, use_speaker_boost: true },
    default: { stability: 0.35, similarity_boost: 0.80, style: 0.30, use_speaker_boost: true },
  };
  return settings[expression] || settings.default;
}

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

// ========== SERVICE METHODS ==========
export async function generateLipSync(messageIndex) {
  // 1. Convert MP3 to 16kHz Mono WAV (Optimal for Rhubarb, 5-8x faster execution)
  await execCommand(
    `"${ffmpegPath}" -y -i audios/message_${messageIndex}.mp3 -vn -ar 16000 -ac 1 -c:a pcm_s16le audios/message_${messageIndex}.wav`
  );
  
  // 2. Generate JSON (Rhubarb)
  // Pastikan path 'bin/rhubarb.exe' sesuai dengan struktur folder project Anda
  await execCommand(
    `bin\\rhubarb.exe -f json -o audios/message_${messageIndex}.json audios/message_${messageIndex}.wav -r phonetic`
  );
}

export async function generateTTS(text, expression, voiceId = VOICE_FEMALE) {
  const settings = getVoiceSettings(expression);
  const selectedVoiceId = voiceId || VOICE_FEMALE;
  
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`,
    {
      text: text,
      model_id: "eleven_v3_conversational", 
      voice_settings: {
        stability: settings.stability,
        similarity_boost: settings.similarity_boost,
        style: settings.style,
        use_speaker_boost: settings.use_speaker_boost,
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
async function processSingleMessage(msg, i, voiceId) {
  const file = `audios/message_${i}.mp3`;
  
  try {
    // 1. Request TTS
    const ttsStart = Date.now();
    const audioBuffer = await generateTTS(msg.text, msg.facialExpression, voiceId);
    const ttsDuration = Date.now() - ttsStart;
    
    // 2. Convert Base64 (In-Memory for Frontend)
    msg.audio = audioBuffer.toString("base64");

    // 3. Save to Disk (Required for LipSync tool)
    await fs.writeFile(file, audioBuffer);

    // 4. Generate LipSync
    const lipsyncStart = Date.now();
    await generateLipSync(i);
    const lipsyncDuration = Date.now() - lipsyncStart;

    // 5. Read Result
    msg.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
    msg._timings = { ttsDuration, lipsyncDuration };

    return msg;

  } catch (err) {
    let errorDetail = err.message;
    if (err.response?.data) {
      try {
        const bodyStr = Buffer.isBuffer(err.response.data)
          ? Buffer.from(err.response.data).toString("utf8")
          : JSON.stringify(err.response.data);
        errorDetail += ` -> ${bodyStr}`;
      } catch (_) {}
    }
    console.error(`[TTS Service] Message ${i} failed: ${errorDetail}`);
    msg.audio = null;
    msg.lipsync = null;
    return msg;
  }
}

// FUNGSI UTAMA (PARALLEL)
export async function processMessagesAudio(messages, voiceId = VOICE_FEMALE) {
  // Jalankan semua proses secara paralel
  await Promise.all(
    messages.map((msg, index) => processSingleMessage(msg, index, voiceId))
  );
  
  return messages;
}
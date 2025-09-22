import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import { promises as fs } from "fs";
import { GoogleGenAI } from "@google/genai";
dotenv.config();


const geminiApiKey = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "21m00Tcm4TlvDq8ikWAM";


const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  await execCommand(
    `ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
    // -y to overwrite the file
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);
  await execCommand(
   `bin\\rhubarb.exe -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  );
  // -r phonetic is faster but less accurate
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};


app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  conversationHistory.push({ role: "user", text: userMessage });

  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Hey dear... How was your day?",
          audio: await audioFileToBase64("audios/intro_0.wav"),
          lipsync: await readJsonTranscript("audios/intro_0.json"),
          facialExpression: "smile",
          animation: "Talking_1",
        },
        {
          text: "I missed you so much... Please don't go for so long!",
          audio: await audioFileToBase64("audios/intro_1.wav"),
          lipsync: await readJsonTranscript("audios/intro_1.json"),
          facialExpression: "sad",
          animation: "Crying",
        },
      ],
    });
    return;
  }
  if (!elevenLabsApiKey || !geminiApiKey) {
    res.send({
      messages: [
        {
          text: "Please my dear, don't forget to add your API keys!",
          audio: await audioFileToBase64("audios/api_0.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"),
          facialExpression: "angry",
          animation: "Angry",
        },
        {
          text: "You don't want to ruin Wawa Sensei with a crazy Gemini and ElevenLabs bill, right?",
          audio: await audioFileToBase64("audios/api_1.wav"),
          lipsync: await readJsonTranscript("audios/api_1.json"),
          facialExpression: "smile",
          animation: "Laughing",
        },
      ],
    });
    return;
  }


const prompt = `
Anda berperan sebagai seorang pasien yang sedang berkonsultasi dengan seorang psikolog. 
Tugas Anda adalah merespons secara alami setiap pertanyaan atau pernyataan dari psikolog. 

⚠️ Aturan penting:
1. Jawaban HARUS berupa JSON array valid TANPA penjelasan tambahan.
2. Setiap objek JSON memiliki format:
   { "text": "...", "facialExpression": "...", "animation": "..." }
3. "text" adalah jawaban pasien (bisa menceritakan masalah, menjawab pertanyaan, atau mengekspresikan perasaan).
4. "facialExpression" hanya boleh: "smile", "sad", "angry", "surprised", "funnyFace", "default".
5. "animation" hanya boleh: "Talking_0", "Talking_1", "Talking_2", "Crying", "Laughing", "Rumba", "Idle", "Terrified", "Angry".

Format contoh:
[
  { "text": "Aku merasa sangat lelah akhir-akhir ini...", "facialExpression": "sad", "animation": "Crying" },
  { "text": "Kenapa dokter menanyakan hal itu?", "facialExpression": "default", "animation": "Talking_1" }
]

User: ${userMessage}
`;


  const geminiRes = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });
  const geminiData = await geminiRes.json();

  function cleanGeminiText(rawText) {
    // hapus code fence ```json ... ```
    return rawText.replace(/```json|```/g, "").trim();
  }

  const validExpressions = ["smile", "sad", "angry", "surprised", "funnyFace", "default"];
  const validAnimations = [
    "Talking_0", "Talking_1", "Talking_2",
    "Crying", "Laughing", "Rumba", "Idle", "Terrified", "Angry"
  ];

  let messages;
  try {
    let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    console.log("🔵 Gemini raw text:", rawText);

    rawText = cleanGeminiText(rawText);

    console.log("🟢 Gemini cleaned text:", rawText);

    messages = JSON.parse(rawText);
    if (messages.messages) messages = messages.messages;

    // sanitasi facialExpression & animation
    messages = messages.map((m, idx) => {
      if (!validExpressions.includes(m.facialExpression)) {
        console.warn(`⚠️ Message ${idx}: invalid facialExpression "${m.facialExpression}", fallback -> "default"`);
        m.facialExpression = "default";
      }
      if (!validAnimations.includes(m.animation)) {
        console.warn(`⚠️ Message ${idx}: invalid animation "${m.animation}", fallback -> "Idle"`);
        m.animation = "Idle";
      }
      return m;
    });

    console.log("✅ Parsed messages:", JSON.stringify(messages, null, 2));

  } catch (e) {
    console.error("❌ Failed to parse Gemini response:", e);
    console.log("Gemini raw response:", JSON.stringify(geminiData, null, 2));
    messages = [
      { text: "Sorry, Gemini response error.", facialExpression: "default", animation: "Idle" }
    ];
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    console.log(`🎙️ Generating audio & lipsync for message_${i}: "${message.text}"`);

    const fileName = `audios/message_${i}.mp3`;
    const textInput = message.text;
    await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, textInput);

    await lipSyncMessage(i);

    message.audio = await audioFileToBase64(fileName);
    message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);

    console.log(`✅ Done message_${i}`);
  }

  res.send({ messages });

});

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

import dotenv from "dotenv";
dotenv.config();

//export const GEMINI_API_URL =  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export const geminiApiKey = process.env.GEMINI_API_KEY;
export const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
export const voiceID = "fUesUKVrbYRcEnWoLXet";

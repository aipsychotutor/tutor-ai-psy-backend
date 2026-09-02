import axios from "axios";
import { callGeminiAPI } from "./geminiService.js";
import SessionModel from "../models/sessionModel.js"; 
import SessionTranscriptModel from "../models/sessionTranscriptModel.js";
import SessionEvaluationModel from "../models/sessionEvaluationModel.js";

// Configuration
const PYTHON_API_URL = process.env.PYTHON_API_URL || process.env.API_URL || "http://localhost:8000";

// ============================================================================
// HELPER: Direct Python API Calls
// ============================================================================

async function classifyDualBatch(texts) {
  try {
    const response = await axios.post(
      `${PYTHON_API_URL}/predict-dual-batch`,
      { texts },
      { timeout: 60000 }
    );
    return response.data;
  } catch (error) {
    throw new Error(`Batch dual classification failed: ${error.message}`);
  }
}

async function classifyEmpathyOnly(text) {
  try {
    const response = await axios.post(
      `${PYTHON_API_URL}/predict-empathy`,
      { text },
      { timeout: 30000 }
    );
    return response.data;
  } catch (error) {
    throw new Error(`Empathy classification failed: ${error.message}`);
  }
}

// ============================================================================
// HELPER: Analyze with Dual Models (Text Analysis)
// ============================================================================

async function analyzeWithDualModels(transcripts) {
  try {
    // Filter only counselor messages
    const counselorMessages = transcripts
      .filter((t) => t.message_role === "user") 
      .map((t) => ({
        text: t.message_text,
        isQuestion: t.message_text.includes("?"), 
      }));

    if (counselorMessages.length === 0) {
      throw new Error("No counselor messages found for analysis");
    }

    // Separate questions and non-questions
    const questions = counselorMessages
      .filter((m) => m.isQuestion)
      .map((m) => m.text);
    const nonQuestions = counselorMessages
      .filter((m) => !m.isQuestion)
      .map((m) => m.text);

    let allResults = [];

    // 1. Analyze questions with BOTH models
    if (questions.length > 0) {
      const questionResponse = await classifyDualBatch(questions);
      if (!questionResponse.success) {
        throw new Error("Python API error: " + questionResponse.error);
      }
      allResults = questionResponse.data.map((result) => ({
        ...result,
        type: "question",
      }));
    }

    // 2. Analyze non-questions with EMPATHY ONLY
    if (nonQuestions.length > 0) {
      const empathyResults = await Promise.all(
        nonQuestions.map(async (text) => {
          const response = await classifyEmpathyOnly(text);
          return {
            text: text,
            question_type: { label: "Bukan Pertanyaan", label_id: -1, confidence: 1.0, probabilities: {} },
            empathy_level: response.data.empathy_level || response.data,
            type: "statement",
          };
        })
      );
      allResults = [...allResults, ...empathyResults];
    }

    // Calculate statistics
    const stats = calculateModelStatistics(
      allResults,
      counselorMessages.length,
      questions.length,
      nonQuestions.length
    );

    return {
      results: allResults,
      statistics: stats,
      total_messages: counselorMessages.length,
      total_questions: questions.length,
      total_statements: nonQuestions.length,
    };
  } catch (error) {
    console.error(`[Text Analysis] Error: ${error.message}`);
    throw new Error(`Model analysis failed: ${error.message}`);
  }
}

// ============================================================================
// HELPER: Rule-Based Prosody Analysis
// ============================================================================

function analyzeProsodyRules(aggregateData) {
  // Jika tidak ada data vokal
  if (!aggregateData || aggregateData.avg_speaking_rate === 0) {
    return {
      has_data: false,
      summary: "Tidak ada data audio tersedia.",
      labels: []
    };
  }

  const { avg_speaking_rate, avg_energy_std, avg_silence_ratio, total_pauses } = aggregateData;
  let labels = [];
  let insights = [];

  // 1. Rule Intonasi (Empatik vs Datar)
  let intonationStatus = "Normal";
  if (avg_energy_std < 0.025) {
    intonationStatus = "Monoton/Datar";
    labels.push("Intonasi Datar");
    insights.push("Variasi nada rendah (monoton), berisiko terdengar kurang berempati atau seperti robot.");
  } else if (avg_energy_std > 0.06) {
    intonationStatus = "Sangat Ekspresif/Dinamis";
    labels.push("Intonasi Dinamis");
    insights.push("Variasi nada tinggi, menunjukkan keterlibatan emosi yang aktif.");
  } else {
    insights.push("Variasi nada cukup baik dan terkontrol.");
  }

  // 2. Rule Kecepatan (Tergesa vs Tenang)
  let speedStatus = "Normal";
  if (avg_speaking_rate > 5.5) {
    speedStatus = "Tergesa-gesa";
    labels.push("Bicara Cepat");
    insights.push("Kecepatan bicara tinggi, berpotensi membuat pasien merasa diburu-buru.");
  } else if (avg_speaking_rate < 2.5) {
    speedStatus = "Sangat Lambat";
    labels.push("Bicara Lambat");
    insights.push("Tempo bicara sangat lambat, mungkin mencoba terlalu hati-hati.");
  } else {
    insights.push("Tempo bicara pas dan tenang.");
  }

  // 3. Rule Keyakinan (Jeda & Silence)
  let confidenceStatus = "Yakin/Lancar";
  if (avg_silence_ratio > 0.35 || (total_pauses / aggregateData.total_speech_duration > 0.5)) {
    confidenceStatus = "Banyak Jeda / Ragu";
    labels.push("Terindikasi Ragu");
    insights.push("Terdapat banyak jeda hening, mengindikasikan keraguan atau sedang berpikir keras mencari kata.");
  } else {
    insights.push("Alur bicara lancar dengan jeda yang wajar.");
  }

  return {
    has_data: true,
    details: {
      intonation: intonationStatus,
      speed: speedStatus,
      confidence: confidenceStatus
    },
    labels: labels,
    insight_text: insights.join(" "),
    raw_summary: `Intonasi: ${intonationStatus}, Kecepatan: ${speedStatus}, Alur: ${confidenceStatus}`
  };
}

// ============================================================================
// HELPER: Generate Feedback with Gemini
// ============================================================================
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateFeedbackWithGemini(
  transcripts,
  modelAnalysis,
  prosodyAnalysis
) {
  const MAX_RETRIES = 3; 
  const RETRY_DELAY_MS = 2000; 

  const stats = modelAnalysis.statistics;

  const conversationText = transcripts
    .map(
      (t) => `${t.message_role === "user" ? "Konselor" : "Pasien"}: ${t.message_text}`
    )
    .join("\n");

  let feedbackPrompt = "";
  const commonPromptHeader = `
Anda adalah supervisor psikologi senior. Tugas Anda adalah memberikan feedback naratif berdasarkan data analisis yang sudah diolah.

DATA PERFORMA TEKS (DARI AI):
- Skor Pertanyaan: ${stats.question_score}/100
- Skor Empati: ${stats.empathy_score}/100

TRANSKRIP SINGKAT:
${conversationText.slice(0, 1500)}... (dipotong agar efisien)
`;

  if (prosodyAnalysis.has_data) {
    feedbackPrompt = `
${commonPromptHeader}

DATA ANALISIS VOKAL/SUARA (HASIL RULE-BASED SYSTEM):
Sistem kami telah menganalisis audio konselor dan menemukan fakta berikut (JANGAN DIUBAH, GUNAKAN SEBAGAI FAKTA):
1. Gaya Intonasi: ${prosodyAnalysis.details.intonation}
2. Kecepatan Bicara: ${prosodyAnalysis.details.speed}
3. Kelancaran/Keyakinan: ${prosodyAnalysis.details.confidence}
4. Catatan Teknis: ${prosodyAnalysis.insight_text}

INSTRUKSI KHUSUS:
Berikan feedback yang menggabungkan analisis teks dan vokal.
- Jika Intonasi "Datar" tapi Teks "Empatik": Kritik bahwa empati verbalnya mungkin tidak tersampaikan dengan tulus karena nada suara yang monoton.
- Jika Kecepatan "Tergesa-gesa": Ingatkan untuk memperlambat tempo agar pasien nyaman.
- Jika "Banyak Jeda": Tanyakan apakah konselor merasa gugup.
- Jangan menebak-nebak angka, gunakan kesimpulan di atas.

OUTPUT (JSON):
{
  "feedback_text": "<Paragraf feedback holistik yang menggabungkan observasi teks dan konfirmasi dari data vokal di atas.>",
  "strengths": ["<Poin kekuatan teks>", "<Poin kekuatan vokal (jika ada, misal: Tempo tenang)>"],
  "improvements": ["<Poin perbaikan teks>", "<Poin perbaikan vokal (misal: Kurangi kecepatan bicara)>"]
}
`;
  } else {
    feedbackPrompt = `
${commonPromptHeader}
(Tidak ada data audio/vokal).

OUTPUT (JSON):
{
  "feedback_text": "<Feedback fokus pada teknik konseling dan penyusunan kalimat berdasarkan transkrip.>",
  "strengths": ["<Kekuatan 1>", "<Kekuatan 2>"],
  "improvements": ["<Perbaikan 1>", "<Perbaikan 2>"]
}
`;
  }

  // --- RETRY LOOP ---
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const geminiData = await callGeminiAPI(feedbackPrompt);

      // --- PARSING RESPONSE ---
      let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      rawText = rawText.replace(/```json|```/g, "").trim();

      const startIndex = rawText.indexOf('{');
      const endIndex = rawText.lastIndexOf('}');

      if (startIndex === -1 || endIndex === -1) {
        throw new Error("Invalid JSON structure received from Gemini");
      }

      const feedback = JSON.parse(rawText.substring(startIndex, endIndex + 1));

      if (!feedback.feedback_text) throw new Error("JSON missing feedback_text");

      return {
        feedback_text: feedback.feedback_text,
        strengths: Array.isArray(feedback.strengths) ? feedback.strengths : [],
        improvements: Array.isArray(feedback.improvements) ? feedback.improvements : [],
        empathy_score: stats.empathy_score,
        question_score: stats.question_score
      };

    } catch (error) {
      console.warn(`[Gemini Feedback] Attempt ${attempt} failed: ${error.message}`);

      if (attempt === MAX_RETRIES) {
        console.error("[Gemini Feedback] All retry attempts failed. Switching to fallback.");
      } else {
        await wait(RETRY_DELAY_MS);
      }
    }
  }

  // Fallback
  return generateFallbackFeedback(modelAnalysis.statistics);
}

// ============================================================================
// STATISTICS & FALLBACK HELPERS 
// ============================================================================

function calculateModelStatistics(results, totalMessages, totalQuestions, totalStatements) {
  // Question type distribution
  const questionCounts = {};
  results.filter((r) => r.type === "question").forEach((r) => {
      const label = r.question_type.label;
      questionCounts[label] = (questionCounts[label] || 0) + 1;
    });

  // Empathy level distribution
  const empathyCounts = {};
  results.forEach((r) => {
    const label = r.empathy_level.label;
    empathyCounts[label] = (empathyCounts[label] || 0) + 1;
  });

  // Calculate percentages
  const questionPercentages = {};
  for (const [label, count] of Object.entries(questionCounts)) {
    questionPercentages[label] = totalQuestions > 0 ? ((count / totalQuestions) * 100).toFixed(1) : "0.0";
  }
  const empathyPercentages = {};
  for (const [label, count] of Object.entries(empathyCounts)) {
    empathyPercentages[label] = ((count / totalMessages) * 100).toFixed(1);
  }

  const questionScore = totalQuestions > 0 ? calculateQuestionScore(questionCounts, totalQuestions) : 0;
  const empathyScore = calculateEmpathyScore(empathyCounts, totalMessages);
  const overallScore = Math.round(questionScore * 0.4 + empathyScore * 0.6);

  return {
    question_distribution: questionCounts,
    question_percentages: questionPercentages,
    empathy_distribution: empathyCounts,
    empathy_percentages: empathyPercentages,
    question_score: Math.round(questionScore),
    empathy_score: Math.round(empathyScore),
    overall_score: overallScore,
  };
}

function calculateQuestionScore(counts, total) {
  const open = counts["Terbuka"] || 0;
  return Math.min(100, Math.round((open / total) * 100) + 40); 
}

function calculateEmpathyScore(counts, total) {
  const empatik = counts["Empatik"] || 0;
  return Math.min(100, Math.round((empatik / total) * 100) + 30);
}

function generateFallbackFeedback(stats) {
  return {
    feedback_text: `Sesi selesai dengan skor ${stats.overall_score}. Mohon periksa detail analisis manual.`,
    strengths: ["Analisis otomatis berhasil"],
    improvements: ["Tingkatkan variasi pertanyaan"]
  };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================


export async function analyzeSession(sessionId, userId) {
    // 1. Validation & Data Fetching
    const session = await SessionModel.getSessionById(sessionId, userId); 
    if (session.status !== "completed") throw new Error("Session is not completed");

    const existingEval = await SessionEvaluationModel.getExistingEvaluation(sessionId);
    if (existingEval) throw new Error("Session already evaluated");

    const transcripts = await SessionTranscriptModel.getTranscriptsBySessionId(sessionId);
    if (!transcripts || transcripts.length === 0) throw new Error("No transcripts found");

    // 2. Text Analysis (Python ML)
    const modelAnalysis = await analyzeWithDualModels(transcripts);

    // 3. Prosody Aggregation & RULE BASED ANALYSIS
    const userMessages = transcripts.filter(t => t.message_role === 'user');
    const validProsodyData = userMessages.map(msg => msg.prosody_data).filter(data => data != null); 

    let aggregateProsody = {
        total_speech_duration: 0,
        avg_speaking_rate: 0,
        avg_energy_std: 0,
        avg_silence_ratio: 0,
        total_pauses: 0,
    };

    if (validProsodyData.length > 0) {
        const sum = (key) => validProsodyData.reduce((acc, data) => acc + (parseFloat(data[key]) || 0), 0);
        aggregateProsody.total_speech_duration = sum('duration');
        aggregateProsody.total_pauses = sum('num_pauses');
        aggregateProsody.avg_speaking_rate = sum('speaking_rate') / validProsodyData.length;
        aggregateProsody.avg_energy_std = sum('energy_std') / validProsodyData.length;
        aggregateProsody.avg_silence_ratio = sum('silence_ratio') / validProsodyData.length;
    }

    // Call Rule-Based System
    const prosodyAnalysisResult = analyzeProsodyRules(aggregateProsody);
    
    // 4. Generate Feedback (Gemini as Writer)
    const geminiFeedback = await generateFeedbackWithGemini(
      transcripts,
      modelAnalysis,
      prosodyAnalysisResult
    );
    
    // 5. Save Evaluation
    const finalEvaluationData = {
        session_id: sessionId,
        empathy_score: geminiFeedback.empathy_score || modelAnalysis.statistics.empathy_score,
        question_score: geminiFeedback.question_score || modelAnalysis.statistics.question_score,
        feedback_text: geminiFeedback.feedback_text,
        strengths: geminiFeedback.strengths,
        improvements: geminiFeedback.improvements,
        classification_results: JSON.stringify(modelAnalysis.results),
        model_statistics: JSON.stringify(modelAnalysis.statistics),
        total_questions: modelAnalysis.total_questions,
        total_statements: modelAnalysis.total_statements,
        prosody_summary: prosodyAnalysisResult
    };
    
    const evaluation = await SessionEvaluationModel.saveSessionEvaluation(finalEvaluationData);
    
    return {
        evaluation: evaluation,
        modelAnalysis: modelAnalysis,
        prosodyAnalysis: prosodyAnalysisResult
    };
}

export { 
    analyzeWithDualModels,
    generateFeedbackWithGemini,
    PYTHON_API_URL
};
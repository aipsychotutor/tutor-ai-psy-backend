import axios from "axios";
import { callGeminiAPI } from "./geminiService.js";
import SessionModel from "../models/sessionModel.js"; 
import SessionTranscriptModel from "../models/sessionTranscriptModel.js";
import SessionEvaluationModel from "../models/sessionEvaluationModel.js";// Dipakai untuk mendapatkan transkrip/menyimpan evaluasi

// Configuration
const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:8000";
// ============================================================================
// HELPER: Direct Python API Calls (Integrated from index.js)
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
// HELPER: Analyze with Dual Models
// ============================================================================

async function analyzeWithDualModels(transcripts) {
  try {
    // Filter only counselor messages
    const counselorMessages = transcripts
      .filter((t) => t.message_role === "user") // user = konselor
      .map((t) => ({
        text: t.message_text,
        isQuestion: t.message_text.includes("?"), // Check if it's a question
      }));

    if (counselorMessages.length === 0) {
      throw new Error("Tidak ada pesan konselor untuk dianalisis");
    }

    // Separate questions and non-questions
    const questions = counselorMessages
      .filter((m) => m.isQuestion)
      .map((m) => m.text);
    const nonQuestions = counselorMessages
      .filter((m) => !m.isQuestion)
      .map((m) => m.text);

    console.log(
      `📊 Analyzing ${counselorMessages.length} counselor messages...`
    );
    console.log(`   - Questions (with ?): ${questions.length}`);
    console.log(`   - Statements (no ?): ${nonQuestions.length}`);

    let allResults = [];

    // 1. Analyze questions with BOTH models (question type + empathy)
    if (questions.length > 0) {
      console.log("🔍 Analyzing questions with dual models...");
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
      console.log("💭 Analyzing statements with empathy model only...");

      // Process empathy in batch
      const empathyResults = await Promise.all(
        nonQuestions.map(async (text) => {
          const response = await classifyEmpathyOnly(text);
          return {
            text: text,
            question_type: {
              label: "Bukan Pertanyaan",
              label_id: -1,
              confidence: 1.0,
              probabilities: {},
            },
            empathy_level: response.data.empathy_level || {
              label: response.data.label,
              label_id: response.data.label_id,
              confidence: response.data.confidence,
              probabilities: response.data.probabilities,
            },
            processing_time_ms: response.data.processing_time_ms || 0,
            type: "statement",
          };
        })
      );

      allResults = [...allResults, ...empathyResults];
    }

    // Calculate statistics (only count questions for question stats)
    const stats = calculateModelStatistics(
      allResults,
      counselorMessages.length,
      questions.length,
      nonQuestions.length
    );

    console.log("✓ Model analysis completed");
    console.log(
      "  Question types (from questions only):",
      stats.question_distribution
    );
    console.log(
      "  Empathy levels (from all messages):",
      stats.empathy_distribution
    );
    console.log("  Overall score:", stats.overall_score);

    return {
      results: allResults,
      statistics: stats,
      total_messages: counselorMessages.length,
      total_questions: questions.length,
      total_statements: nonQuestions.length,
    };
  } catch (error) {
    console.error("❌ Dual model analysis error:", error.message);
    throw new Error(`Model analysis failed: ${error.message}`);
  }
}

// ============================================================================
// HELPER: Calculate Statistics from Model Results
// ============================================================================

function calculateModelStatistics(
  results,
  totalMessages,
  totalQuestions,
  totalStatements
) {
  // Question type distribution (only from questions)
  const questionCounts = {};
  results
    .filter((r) => r.type === "question")
    .forEach((r) => {
      const label = r.question_type.label;
      questionCounts[label] = (questionCounts[label] || 0) + 1;
    });

  // Empathy level distribution (from all messages)
  const empathyCounts = {};
  results.forEach((r) => {
    const label = r.empathy_level.label;
    empathyCounts[label] = (empathyCounts[label] || 0) + 1;
  });

  // Calculate percentages for questions (based on total questions only)
  const questionPercentages = {};
  for (const [label, count] of Object.entries(questionCounts)) {
    questionPercentages[label] =
      totalQuestions > 0 ? ((count / totalQuestions) * 100).toFixed(1) : "0.0";
  }

  // Calculate percentages for empathy (based on total messages)
  const empathyPercentages = {};
  for (const [label, count] of Object.entries(empathyCounts)) {
    empathyPercentages[label] = ((count / totalMessages) * 100).toFixed(1);
  }

  // Calculate scores (0-100)
  const questionScore =
    totalQuestions > 0
      ? calculateQuestionScore(questionCounts, totalQuestions)
      : 0;
  const empathyScore = calculateEmpathyScore(empathyCounts, totalMessages);

  // Overall score (weighted average)
  const overallScore = Math.round(questionScore * 0.4 + empathyScore * 0.6);

  // Calculate average confidences
  const avgQuestionConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.question_type.confidence, 0) /
        results.length
      : 0;

  const avgEmpathyConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.empathy_level.confidence, 0) /
        results.length
      : 0;

  // Detect patterns
  const patterns = detectPatterns(results);

  return {
    question_distribution: questionCounts,
    question_percentages: questionPercentages,
    empathy_distribution: empathyCounts,
    empathy_percentages: empathyPercentages,
    question_score: Math.round(questionScore),
    empathy_score: Math.round(empathyScore),
    overall_score: overallScore,
    avg_question_confidence: avgQuestionConfidence,
    avg_empathy_confidence: avgEmpathyConfidence,
    patterns: patterns,
  };
}

// ============================================================================
// HELPER: Calculate Question Score
// ============================================================================

function calculateQuestionScore(questionCounts, total) {
  let score = 0;

  const openPercentage = ((questionCounts["Terbuka"] || 0) / total) * 100;
  const reflectivePercentage =
    ((questionCounts["Reflektif"] || 0) / total) * 100;
  const suggestivePercentage =
    ((questionCounts["Sugestif"] || 0) / total) * 100;
  const closedPercentage = ((questionCounts["Tertutup"] || 0) / total) * 100;

  // Open questions (40 points) - optimal: 40-60%
  if (openPercentage >= 40 && openPercentage <= 60) {
    score += 40;
  } else if (openPercentage >= 30 && openPercentage < 70) {
    score += 30;
  } else if (openPercentage >= 20) {
    score += 20;
  } else {
    score += 10;
  }

  // Reflective statements (25 points) - optimal: 15-30%
  if (reflectivePercentage >= 15 && reflectivePercentage <= 30) {
    score += 25;
  } else if (reflectivePercentage >= 10) {
    score += 20;
  } else if (reflectivePercentage >= 5) {
    score += 10;
  }

  // Low suggestive (20 points) - optimal: <20%
  if (suggestivePercentage < 15) {
    score += 20;
  } else if (suggestivePercentage < 25) {
    score += 15;
  } else if (suggestivePercentage < 35) {
    score += 10;
  } else {
    score += 5;
  }

  // Balanced closed questions (15 points) - optimal: 10-30%
  if (closedPercentage >= 10 && closedPercentage <= 30) {
    score += 15;
  } else if (closedPercentage < 40) {
    score += 10;
  } else {
    score += 5;
  }

  return score;
}

// ============================================================================
// HELPER: Calculate Empathy Score
// ============================================================================

function calculateEmpathyScore(empathyCounts, total) {
  let score = 0;

  const empaticPercentage = ((empathyCounts["Empatik"] || 0) / total) * 100;
  const neutralPercentage = ((empathyCounts["Netral"] || 0) / total) * 100;
  const judgementalPercentage =
    ((empathyCounts["Judgemental"] || 0) / total) * 100;

  // Empathetic responses (70 points) - optimal: >60%
  if (empaticPercentage >= 70) {
    score += 70;
  } else if (empaticPercentage >= 60) {
    score += 65;
  } else if (empaticPercentage >= 50) {
    score += 55;
  } else if (empaticPercentage >= 40) {
    score += 40;
  } else if (empaticPercentage >= 30) {
    score += 25;
  } else {
    score += 15;
  }

  // No judgemental responses (30 points)
  if (judgementalPercentage === 0) {
    score += 30;
  } else if (judgementalPercentage < 5) {
    score += 25;
  } else if (judgementalPercentage < 10) {
    score += 15;
  } else if (judgementalPercentage < 20) {
    score += 10;
  } else {
    score += 5;
  }

  return score;
}

// ============================================================================
// HELPER: Detect Patterns
// ============================================================================

function detectPatterns(results) {
  const patterns = [];

  // Pattern 1: Most common combination
  const combinations = {};
  results.forEach((r) => {
    const key = `${r.question_type.label}-${r.empathy_level.label}`;
    combinations[key] = (combinations[key] || 0) + 1;
  });

  const sortedCombos = Object.entries(combinations).sort((a, b) => b[1] - a[1]);

  if (sortedCombos.length > 0) {
    patterns.push({
      type: "most_common",
      pattern: sortedCombos[0][0],
      count: sortedCombos[0][1],
      percentage: ((sortedCombos[0][1] / results.length) * 100).toFixed(1),
    });
  }

  // Pattern 2: Empathy trend
  if (results.length >= 3) {
    const empathyScores = results.map((r) => {
      if (r.empathy_level.label === "Empatik") return 1;
      if (r.empathy_level.label === "Netral") return 0;
      return -1; // Judgemental
    });

    const firstHalf = empathyScores.slice(
      0,
      Math.floor(empathyScores.length / 2)
    );
    const secondHalf = empathyScores.slice(
      Math.floor(empathyScores.length / 2)
    );

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (avgSecond > avgFirst + 0.2) {
      patterns.push({ type: "empathy_trend", direction: "improving" });
    } else if (avgFirst > avgSecond + 0.2) {
      patterns.push({ type: "empathy_trend", direction: "declining" });
    } else {
      patterns.push({ type: "empathy_trend", direction: "consistent" });
    }
  }

  // Pattern 3: Question diversity
  const uniqueQuestionTypes = new Set(
    results
      .filter((r) => r.type === "question")
      .map((r) => r.question_type.label)
  ).size;
  patterns.push({
    type: "question_diversity",
    unique_types: uniqueQuestionTypes,
    total_types: 4,
  });

  return patterns;
}

// ============================================================================
// HELPER: Generate Feedback with Gemini
// ============================================================================

async function generateFeedbackWithGemini(
  transcripts,
  modelAnalysis,
  aggregateProsody
) {
  try {
    const stats = modelAnalysis.statistics;

    const conversationText = transcripts
      .map(
        (t) =>
          `${t.message_role === "user" ? "Konselor" : "Pasien"}: ${
            t.message_text
          }`
      )
      .join("\n");

      let feedbackPrompt="";
      const hasVocalData = aggregateProsody.avg_speaking_rate > 0;

    const commonPromptHeader = `
Anda adalah supervisor psikologi yang berpengalaman yang sedang menilai calon psikolog/konselor. Berikan feedback dan analisis konstruktif berdasarkan DUA set data berikut: Analisis AI dan Data Intonasi.

HASIL ANALISIS MODEL AI (TEKS):
- Skor Pertanyaan: ${stats.question_score}/100
- Skor Empati: ${stats.empathy_score}/100
- Skor Keseluruhan: ${stats.overall_score}/100

DISTRIBUSI TIPE PERTANYAAN:
${Object.entries(stats.question_percentages)
  .map(([k, v]) => `- ${k}: ${v}%`)
  .join("\n")}

DISTRIBUSSI TINGKAT EMPATI:
${Object.entries(stats.empathy_percentages)
  .map(([k, v]) => `- ${k}: ${v}%`)
  .join("\n")}

TRANSKRIP SESI (untuk konteks):
${conversationText}
`;

  if(hasVocalData){
     console.log("🎙️ Generating feedback WITH vocal analysis...");
      feedbackPrompt = `
${commonPromptHeader}
  
---
DATA INTONASI KESELURUHAN (DARI USER/KONSELOR):
Rata-rata Kecepatan Bicara: ${aggregateProsody.avg_speaking_rate.toFixed(2)} (Normal: ~3-5. Lebih tinggi = lebih cepat)
Rata-rata Variabilitas Energi (energy_std): ${aggregateProsody.avg_energy_std.toFixed(4)} (Tinggi = Dinamis/Ekspresif, Rendah = Monoton/Datar)
Rata-rata Rasio Diam (Hening): ${(aggregateProsody.avg_silence_ratio * 100).toFixed(0)}% (Tinggi = banyak jeda, mungkin ragu-ragu atau berpikir)
Total Jeda Konselor: ${aggregateProsody.total_pauses} kali
---

ANALISIS ANDA (HANYA JAWAB DALAM FORMAT JSON YANG VALID):
{
  "empathy_score": ${stats.empathy_score},
  "question_score": ${stats.question_score},
  "feedback_text": "<Feedback umum 1 paragraf. WAJIB sertakan analisis intonasi Anda di sini. Gunakan data 'Variabilitas Energi', 'Kecepatan Bicara', dan 'Rasio Diam' untuk menganalisis 'engagement' dan 'rapport' konselor. Jelaskan BAGAIMANA data intonasi tersebut memengaruhi persepsi empati klien. Contoh: Apakah 'Variabilitas Energi' yang rendah (monoton) membuat pernyataan empatik (dari transkrip) terdengar tidak tulus? Apakah 'Kecepatan Bicara' yang tinggi (terburu-buru) mengurangi kesempatan klien untuk berefleksi? Apakah 'Rasio Diam' yang tinggi menunjukkan konselor sedang berpikir reflektif (baik) atau ragu-ragu (kurang percaya diri)? Kaitkan temuan intonasi ini dengan skor AI yang didapat. (Gunakan \\n untuk newline JIKA PERLU. Seluruh feedback ini HARUS dalam satu string JSON tunggal)>","feedback_text": "<Feedback umum 1 paragraf. WAJIB sertakan analisis intonasi Anda di sini. Jelaskan apa arti dari data 'Variabilitas Energi' dan 'Kecepatan Bicara' konselor dalam konteks transkrip. Apakah konselor terdengar cemas (cepat, monoton)? Atau tenang (normal, dinamis)? Atau ragu-ragu (rasio diam tinggi)?(Gunakan \\n untuk newline JIKA PERLU. Seluruh feedback ini HARUS dalam satu string JSON tunggal)>",
  "strengths": ["<poin kekuatan 1 berdasarkan analisis AI>", "<poin kekuatan 2>"],
  "improvements": ["<poin perbaikan 1 berdasarkan analisis AI>", "<poin perbaikan 2>"]
}
`;
  } else{
    console.log("📝 Generating feedback WITHOUT vocal analysis (text only)...");
      feedbackPrompt = `
${commonPromptHeader}
---
(Tidak ada data intonasi vokal yang tersedia untuk sesi ini.)
---

ANALISIS ANDA (HANYA JAWAB DALAM FORMAT JSON):
{
  "strengths": ["<Kekuatan 1 konselor berdasarkan Data 1 & 2 (Teks)>", "<Kekuatan 2 konselor (Teks)>"],
  "improvements": ["<Perbaikan 1 konselor berdasarkan Data 1 & 2 (Teks)>", "<Perbaikan 2 konselor (Teks)>"],
  
  "feedback_text": <Feedback umum 1 paragraf. Gunakan Hasil Analisis Model AI untuk menganalisis empati dan teknik bertanya konselor.(Gunakan \\n untuk newline JIKA PERLU. Seluruh feedback ini HARUS dalam satu string JSON tunggal)>",
}
`;
    }
  
    const geminiData = await callGeminiAPI(feedbackPrompt);

    // --- PARSING RESPONSE ---
    // Kita ambil text mentah dari struktur response Google
    let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    // 1. Bersihkan markdown fences
    rawText = rawText.replace(/```json|```/g, "").trim();

    // 2. Temukan blok JSON yang valid (dari { pertama hingga } terakhir)
    const startIndex = rawText.indexOf('{');
    const endIndex = rawText.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
       console.error("❌ Gagal menemukan objek JSON yang valid di respons Gemini. Teks Mentah:", rawText);
       throw new Error("Struktur JSON tidak valid dari respons Gemini.");
    }

    // 3. Ekstrak string JSON
    const jsonString = rawText.substring(startIndex, endIndex + 1);

    // 4. Parse
    let feedback;
    try {
      feedback = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("❌ Error parsing JSON extracted:", parseError.message);
      console.error("String JSON yang gagal di-parse:", jsonString);
      throw new Error(`JSON parse error after extraction: ${parseError.message}`);
    }

    console.log("✓ Gemini feedback generated successfully");

    return {
      feedback_text: feedback.feedback_text,
      strengths: Array.isArray(feedback.strengths) ? feedback.strengths : [],
      improvements: Array.isArray(feedback.improvements)
        ? feedback.improvements
        : [],
    };
  } catch (error) {
    console.error("❌ Gemini feedback error:", error.message);

    // Fallback feedback based on model scores
    return generateFallbackFeedback(modelAnalysis.statistics);
  }
}

// ============================================================================
// HELPER: Fallback Feedback (if Gemini fails)
// ============================================================================

function generateFallbackFeedback(stats) {
  const feedback = {
    feedback_text: "",
    strengths: [],
    improvements: [],
  };

  // Generate feedback text
  let feedbackParts = [];

  feedbackParts.push(
    `Berdasarkan analisis AI, sesi konseling Anda mendapat skor keseluruhan ${stats.overall_score}/100. ` +
      `Skor pertanyaan: ${stats.question_score}/100, Skor empati: ${stats.empathy_score}/100.`
  );

  // Question analysis
  const openPct = parseFloat(stats.question_percentages["Terbuka"] || 0);
  if (openPct >= 40) {
    feedbackParts.push(
      `Penggunaan pertanyaan terbuka (${openPct}%) sudah baik, ini mendorong klien untuk eksplorasi.`
    );
  } else {
    feedbackParts.push(
      `Pertanyaan terbuka masih ${openPct}%, disarankan ditingkatkan menjadi minimal 40%.`
    );
  }

  // Empathy analysis
  const empaticPct = parseFloat(stats.empathy_percentages["Empatik"] || 0);
  if (empaticPct >= 60) {
    feedbackParts.push(
      `Tingkat empati (${empaticPct}%) sangat baik, menunjukkan kemampuan memahami klien dengan baik.`
    );
  } else {
    feedbackParts.push(
      `Tingkat empati ${empaticPct}% perlu ditingkatkan untuk membangun rapport yang lebih kuat.`
    );
  }

  feedback.feedback_text = feedbackParts.join(" ");

  // Strengths
  if (stats.overall_score >= 80) {
    feedback.strengths.push(
      "Performa konseling secara keseluruhan sangat baik"
    );
  }
  if (openPct >= 40) {
    feedback.strengths.push("Penggunaan pertanyaan terbuka yang efektif");
  }
  if (empaticPct >= 60) {
    feedback.strengths.push("Menunjukkan empati yang tinggi terhadap klien");
  }
  if (parseFloat(stats.empathy_percentages["Judgemental"] || 0) === 0) {
    feedback.strengths.push("Tidak ada pernyataan judgemental terdeteksi");
  }

  // Improvements
  if (openPct < 40) {
    feedback.improvements.push(
      "Tingkatkan penggunaan pertanyaan terbuka (open-ended questions)"
    );
  }
  if (empaticPct < 60) {
    feedback.improvements.push(
      "Tingkatkan ekspresi empati dan validasi emosi klien"
    );
  }
  if (parseFloat(stats.question_percentages["Sugestif"] || 0) > 25) {
    feedback.improvements.push(
      "Kurangi pertanyaan sugestif, berikan lebih banyak ruang untuk eksplorasi klien"
    );
  }
  if (parseFloat(stats.empathy_percentages["Judgemental"] || 0) > 0) {
    feedback.improvements.push(
      "Hindari pernyataan yang bersifat judgemental atau menghakimi"
    );
  }

  return feedback;
}

export async function analyzeSession(sessionId, userId) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`📊 Starting comprehensive analysis for session: ${sessionId}`);
    console.log("=".repeat(70));
    
    // 1. Check if session exists and is completed (USING MODEL)
    // Gunakan SessionModel untuk memverifikasi kepemilikan dan mengambil data sesi
    const session = await SessionModel.getSessionById(sessionId, userId); 
    
    if (session.status !== "completed") {
      throw new Error("Session belum selesai, tidak bisa dianalisis");
    }

    // 2. Check if already evaluated (USING MODEL)
    // Gunakan SessionEvaluationModel untuk cek evaluasi
    const existingEval = await SessionEvaluationModel.getExistingEvaluation(sessionId);
    if (existingEval) {
      throw new Error("Session sudah pernah dievaluasi");
    }

    // 3. Get transcripts (USING MODEL)
    // Gunakan SessionTranscriptModel untuk ambil transkrip
    const transcripts = await SessionTranscriptModel.getTranscriptsBySessionId(sessionId);
    if (!transcripts || transcripts.length === 0) {
      throw new Error("Tidak ada transkrip untuk dianalisis");
    }
    console.log(`📝 Found ${transcripts.length} transcript messages`);

    // 4. Analyze with Dual Models (Python ML)
    console.log("\n🤖 Step 1: Analyzing with AI models (Python ML)...");
    const modelAnalysis = await analyzeWithDualModels(transcripts);

    // 5. Aggregate prosody data (Logika ini tetap di Service)
    console.log("\n🎵 Step 1B: Aggregating prosody data...");
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
        console.log("✅ Prosody data aggregated.");
    } else {
        console.log("⚠️ No valid prosody data found for this session.");
    }
    
    // 6. Generate Feedback with Gemini (LLM)
    console.log("\n💬 Step 2: Generating feedback with Gemini...");
    const geminiFeedback = await generateFeedbackWithGemini(
      transcripts,
      modelAnalysis,
      aggregateProsody
    );
    
    // 7. Persiapan Data Evaluasi Akhir
    const finalEvaluationData = {
        session_id: sessionId,
        empathy_score: geminiFeedback.empathy_score || modelAnalysis.statistics.empathy_score,
        question_score: geminiFeedback.question_score || modelAnalysis.statistics.question_score,
        ethics_score: modelAnalysis.statistics.ethics_score, // Dari perhitungan statistik lokal
        feedback_text: geminiFeedback.feedback_text,
        strengths: geminiFeedback.strengths,
        improvements: geminiFeedback.improvements,
        classification_results: JSON.stringify(modelAnalysis.results),
        model_statistics: JSON.stringify(modelAnalysis.statistics),
        total_questions: modelAnalysis.total_questions,
        total_statements: modelAnalysis.total_statements,
    };
    
    // Gunakan SessionEvaluationModel untuk menyimpan hasil
    console.log("\n💾 Step 3: Saving evaluation to database...");
    const evaluation = await SessionEvaluationModel.saveSessionEvaluation(finalEvaluationData);

    console.log("✅ Analysis completed successfully!");
    console.log("=".repeat(70) + "\n");
    
    return {
        evaluation: evaluation,
        modelAnalysis: modelAnalysis,
        python_api_used: PYTHON_API_URL,
    };
}

export { 
    analyzeWithDualModels,
    generateFeedbackWithGemini,
    PYTHON_API_URL
};
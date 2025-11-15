import express from "express";
import axios from "axios";
import { supabase } from "../supabase.js";
import { GEMINI_API_URL, geminiApiKey } from "../constant.js";

const router = express.Router();

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

async function generateFeedbackWithGemini(transcripts, modelAnalysis) {
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

    const feedbackPrompt = `
Anda adalah supervisor psikologi yang berpengalaman. Berikan feedback konstruktif berdasarkan analisis AI berikut:

HASIL ANALISIS MODEL AI:
- Skor Pertanyaan: ${stats.question_score}/100
- Skor Empati: ${stats.empathy_score}/100
- Skor Keseluruhan: ${stats.overall_score}/100

DISTRIBUSI TIPE PERTANYAAN:
${Object.entries(stats.question_percentages)
  .map(([k, v]) => `- ${k}: ${v}%`)
  .join("\n")}

DISTRIBUSI TINGKAT EMPATI:
${Object.entries(stats.empathy_percentages)
  .map(([k, v]) => `- ${k}: ${v}%`)
  .join("\n")}

POLA TERDETEKSI:
${stats.patterns.map((p) => `- ${p.type}: ${JSON.stringify(p)}`).join("\n")}

TRANSKRIP SESI (untuk konteks):
${conversationText}

Berikan feedback dalam format JSON:
{
  "feedback_text": "<feedback konstruktif 2-3 paragraf dalam bahasa Indonesia yang menjelaskan hasil analisis AI dan memberikan konteks>",
  "strengths": ["<kekuatan 1>", "<kekuatan 2>", "<kekuatan 3>"],
  "improvements": ["<area perbaikan 1 dengan saran spesifik>", "<area perbaikan 2 dengan saran spesifik>", "<area perbaikan 3 dengan saran spesifik>"]
}

PEDOMAN:
- Feedback harus merujuk pada hasil analisis AI
- Jelaskan apa arti dari distribusi pertanyaan dan empati
- Berikan contoh konkret dari transkrip jika relevan
- Strengths: 2-4 poin kekuatan yang spesifik
- Improvements: 2-4 poin area perbaikan dengan saran actionable
- Gunakan bahasa yang supportive namun objektif

PENTING: Output HANYA JSON yang valid, tanpa teks tambahan atau markdown.
`;

    console.log("🤖 Generating feedback with Gemini...");

    const geminiRes = await axios.post(
      `${GEMINI_API_URL}?key=${geminiApiKey}`,
      {
        contents: [
          {
            parts: [{ text: feedbackPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000,
        },
      },
      {
        timeout: 30000,
      }
    );

    let rawText =
      geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    rawText = rawText.replace(/```json|```/g, "").trim();

    const feedback = JSON.parse(rawText);

    console.log("✓ Gemini feedback generated");

    return {
      feedback_text: feedback.feedback_text || "Feedback tidak tersedia",
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

// ============================================================================
// ROUTES
// ============================================================================

// GET /api/sessions/stats
router.get("/stats", async (req, res) => {
  try {
    const user_id = req.user.user_id;
    console.log(`📊 START: Fetching Stats for User ID: ${user_id}`);

    // ... (Langkah 1 & 2: Pengambilan dan Pemfilteran Data - KODE SUDAH BENAR) ...
    
    const { data: evaluations, error: evalError } = await supabase
      .from("session_evaluations")
      .select(`
          empathy_score,
          question_score,
          sessions!inner(user_id)// Ambil user_id dari tabel sessions yang terhubung
      `)
      // Filter evaluasi hanya jika sesi terhubung dimiliki oleh user_id yang sekarang
      .filter('sessions.user_id', 'eq', user_id);
      
  if (evalError) throw evalError;
  console.log(`1. Supabase returned ${evaluations.length} evaluation records.`);

  // Ganti variabel evaluatedSessions dan totalEvaluations
  const evaluatedSessions = evaluations;
  const totalEvaluations = evaluations.length; 

  console.log(`2. Total Evaluations (Sesi dievaluasi): ${totalEvaluations}`);
    
    if (totalEvaluations > 0) {
      console.log("   Data Evaluasi Mentah:");
      evaluatedSessions.forEach((evalData, index) => {
        console.log(`     #${index + 1}: Empathy=${evalData.empathy_score}, Question=${evalData.question_score}`);
      });
    }

    if (totalEvaluations === 0) {
        // ... (return 0)
        return res.json({
            success: true,
            message: "Belum ada sesi yang dievaluasi",
            data: {
              total_evaluations: 0,
              avg_empathy_score: 0,
              avg_question_score: 0,
            }
          });
    }

     // 3. Hitung total skor (PERBAIKAN KRITIS DI SINI)
     const sumScores = evaluatedSessions.reduce(
        (acc, evalData) => {
            // Ambil skor, pastikan konversi ke Number, dan jika null/undefined, gunakan 0
            const empathy = Number(evalData.empathy_score ?? 0);
            const question = Number(evalData.question_score ?? 0);

            // Lakukan Penjumlahan
            acc.totalEmpathy += empathy;
            acc.totalQuestion += question;
            
            // Log Debugging (Hanya untuk konfirmasi, lihat output terminal)
            console.log(`   - Adding: Empathy=${empathy}, Question=${question}. Current Sum: E=${acc.totalEmpathy}, Q=${acc.totalQuestion}`);

            return acc;
        },
        { totalEmpathy: 0, totalQuestion: 0 }
    );

    // Hitung rata-rata
    const avg_empathy_score = sumScores.totalEmpathy / totalEvaluations;
    const avg_question_score = sumScores.totalQuestion / totalEvaluations;

    const final_avg_empathy = parseFloat(avg_empathy_score.toFixed(1));
    const final_avg_question = parseFloat(avg_question_score.toFixed(1));

    console.log(`3. Final Total Sum: Empathy=${sumScores.totalEmpathy}, Question=${sumScores.totalQuestion}`);
    console.log(`4. Calculated Average Empathy: ${final_avg_empathy}`);
    console.log(`   Calculated Average Question: ${final_avg_question}`);
    console.log(`======================================================\n`);

    res.json({
      success: true,
      message: "Statistik rata-rata berhasil diambil",
      data: {
        total_evaluations: totalEvaluations,
        avg_empathy_score: final_avg_empathy,
        avg_question_score: final_avg_question,
      },
    });

  } catch (error) {
    // ... (Error handling)
    console.error("Error fetching average stats:", error);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data statistik: " + error.message,
    });
  }
});

// GET /api/sessions
router.get("/", async (req, res) => {
  try {
    const { patient_id, status } = req.query;
    const user_id = req.user.user_id;

    let query = supabase
      .from("sessions")
      .select(
        `
          session_id,
          patient_id,
          start_time,
          end_time,
          status,
          patients (
            patient_name,
            profile_image
          )
        `
      )
      .order("start_time", { ascending: false })
      .eq("user_id", user_id);

    if (patient_id) {
      query = query.eq("patient_id", patient_id);
    }

    if (status) {
      query = query.eq("status", status);
    }

    const { data: sessions, error } = await query;

    if (error) throw error;

    const formattedSessions = sessions.map((s) => {
      return {
        session_id: s.session_id,
        patient_id: s.patient_id,
        patient_name: s.patients?.patient_name || "Unknown",
        patient_image: s.patients?.profile_image || null,
        start_time: s.start_time,
        end_time: s.end_time,
        status: s.status || "ongoing",
      };
    });

    res.json({
      success: true,
      data: formattedSessions,
    });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// POST /api/sessions
router.post("/", async (req, res) => {
  try {
    const { patient_id } = req.body;
    const user_id = req.user.user_id;

    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("patient_id")
      .eq("patient_id", patient_id)
      .or(`user_id.eq.${user_id},user_id.is.null`)
      .single();

    if (patientError || !patient) {
      return res.status(404).json({
        success: false,
        message: "Patient tidak ditemukan atau Anda tidak punya akses.",
      });
    }

    const { data: session, error } = await supabase
      .from("sessions")
      .insert([
        {
          user_id: user_id,
          patient_id: patient_id,
          start_time: new Date().toISOString(),
          status: "ongoing",
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Error creating session:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET /api/sessions/:id
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.user_id;

    const { data: session, error } = await supabase
      .from("sessions")
      .select(
        `
          *,
          patients (
            patient_name,
            profile_image,
            age,
            gender
          )
        `
      )
      .eq("session_id", id)
      .eq("user_id", user_id)
      .single();

    if (error) throw error;

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan atau Anda tidak punya akses",
      });
    }

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Error fetching session:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// PATCH /api/sessions/:id
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.user_id;
    const { status, end_time } = req.body;

    const validStatuses = ["ongoing", "completed", "cancelled"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status harus salah satu dari: ${validStatuses.join(", ")}`,
      });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (end_time) updateData.end_time = end_time;

    const { data, error } = await supabase
      .from("sessions")
      .update(updateData)
      .eq("session_id", id)
      .eq("user_id", user_id)
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan atau Anda tidak punya akses",
      });
    }

    res.json({
      success: true,
      message: "Session berhasil diupdate",
      data,
    });
  } catch (error) {
    console.error("Error updating session:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET /api/sessions/:session_id/transcripts
router.get("/:session_id/transcripts", async (req, res) => {
  try {
    const { session_id } = req.params;
    const user_id = req.user.user_id;

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("session_id")
      .eq("session_id", session_id)
      .eq("user_id", user_id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan atau Anda tidak punya akses",
      });
    }

    const { data, error } = await supabase
      .from("session_transcripts")
      .select("*")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error fetching transcripts:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// POST /api/sessions/:session_id/analyze
router.post("/:session_id/analyze", async (req, res) => {
  try {
    const { session_id } = req.params;
    const user_id = req.user.user_id;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`📊 Starting analysis for session: ${session_id}`);
    console.log("=".repeat(70));

    // 1. Check if session exists and is completed
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("status, start_time, end_time")
      .eq("session_id", session_id)
      .eq("user_id", user_id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan atau Anda tidak punya akses",
      });
    }

    if (session.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Session belum selesai, tidak bisa dianalisis",
      });
    }

    // 2. Check if already evaluated
    const { data: existingEval } = await supabase
      .from("session_evaluations")
      .select("evaluation_id")
      .eq("session_id", session_id)
      .single();

    if (existingEval) {
      return res.status(400).json({
        success: false,
        message: "Session sudah pernah dievaluasi",
      });
    }

    // 3. Get transcripts
    const { data: transcripts, error: transcriptError } = await supabase
      .from("session_transcripts")
      .select("*")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true });

    if (transcriptError || !transcripts || transcripts.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Tidak ada transkrip untuk dianalisis",
      });
    }

    console.log(`📝 Found ${transcripts.length} transcript messages`);

    // 4. Analyze with Dual Models (Question Type + Empathy)
    console.log("\n🤖 Step 1: Analyzing with AI models...");
    const modelAnalysis = await analyzeWithDualModels(transcripts);

    // 5. Generate Feedback with Gemini
    console.log("\n💬 Step 2: Generating feedback with Gemini...");
    const geminiFeedback = await generateFeedbackWithGemini(
      transcripts,
      modelAnalysis
    );

    // 6. Calculate ethics score (placeholder - could be enhanced)
    // For now, we'll derive it from model scores
    const ethicsScore = Math.round(
      modelAnalysis.statistics.overall_score * 0.8 +
        (100 -
          parseFloat(
            modelAnalysis.statistics.empathy_percentages["Judgemental"] || 0
          )) *
          0.2
    );

    // 7. Save evaluation to database
    console.log("\n💾 Step 3: Saving evaluation to database...");
    const { data: evaluation, error: evalError } = await supabase
      .from("session_evaluations")
      .insert([
        {
          session_id,
          empathy_score: modelAnalysis.statistics.empathy_score,
          question_score: modelAnalysis.statistics.question_score,
          ethics_score: ethicsScore,
          feedback_text: geminiFeedback.feedback_text,
          strengths: geminiFeedback.strengths,
          improvements: geminiFeedback.improvements,
          classification_results: JSON.stringify(modelAnalysis.results),
          model_statistics: JSON.stringify(modelAnalysis.statistics),
          total_questions: modelAnalysis.total_questions,
          total_statements: modelAnalysis.total_statements,
        },
      ])
      .select()
      .single();

    if (evalError) {
      throw evalError;
    }

    console.log("\n✅ Analysis completed successfully!");
    console.log(
      `   Question Score: ${modelAnalysis.statistics.question_score}/100`
    );
    console.log(
      `   Empathy Score: ${modelAnalysis.statistics.empathy_score}/100`
    );
    console.log(`   Ethics Score: ${ethicsScore}/100`);
    console.log(
      `   Overall Score: ${modelAnalysis.statistics.overall_score}/100`
    );
    console.log("=".repeat(70) + "\n");

    res.json({
      success: true,
      message: "Evaluasi berhasil disimpan",
      evaluation: evaluation,
      classification_results: modelAnalysis.results,
      detailed_analysis: {
        model_statistics: modelAnalysis.statistics,
        patterns: modelAnalysis.statistics.patterns,
        total_counselor_messages: modelAnalysis.total_messages,
        python_api_used: PYTHON_API_URL,
      },
    });
  } catch (err) {
    console.error("\n❌ Error analyzing session:", err);
    console.error("Stack trace:", err.stack);

    res.status(500).json({
      success: false,
      message: err.message,
      details: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
});

export default router;

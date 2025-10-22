import express from "express";
import { supabase } from "../supabase.js";

const router = express.Router();

// Helper function untuk analisis dengan Gemini
async function analyzeSessionWithAI(transcripts) {
  const conversationText = transcripts
    .map(
      (t) =>
        `${t.message_role === "user" ? "Konselor" : "Pasien"}: ${
          t.message_text
        }`
    )
    .join("\n");

  const analysisPrompt = `
Anda adalah supervisor psikologi yang berpengalaman. Analisis sesi konseling berikut dan berikan penilaian objektif.

TRANSKRIP SESI:
${conversationText}

Berikan penilaian dalam format JSON berikut:
{
  "empathy_score": <0-100, seberapa baik konselor menunjukkan empati dan pemahaman>,
  "question_score": <0-100, kualitas pertanyaan (open-ended, exploratory, tidak leading)>,
  "ethics_score": <0-100, kepatuhan terhadap etika konseling (boundary, confidentiality)>,
  "feedback_text": "<feedback konstruktif dalam bahasa Indonesia, 2-3 paragraf>",
  "strengths": ["<kekuatan 1>", "<kekuatan 2>"],
  "improvements": ["<area perbaikan 1>", "<area perbaikan 2>"]
}

Kriteria Penilaian:
- Empathy: validasi emosi, reflective listening, tidak judgmental
- Question: rasio open vs closed, timing, tidak interrupt
- Ethics: tidak memberikan advice prematur, menjaga boundary, tidak self-disclosure berlebihan

PENTING: Output HANYA JSON, tanpa teks tambahan.
`;

  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: analysisPrompt }] }],
        }),
      }
    );

    if (!geminiRes.ok) {
      throw new Error(`Gemini API error: ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    rawText = rawText.replace(/```json|```/g, "").trim();

    const analysis = JSON.parse(rawText);

    // Validate scores
    analysis.empathy_score = Math.max(
      0,
      Math.min(100, analysis.empathy_score || 0)
    );
    analysis.question_score = Math.max(
      0,
      Math.min(100, analysis.question_score || 0)
    );
    analysis.ethics_score = Math.max(
      0,
      Math.min(100, analysis.ethics_score || 0)
    );

    return analysis;
  } catch (err) {
    console.error("❌ AI analysis error:", err);
    return {
      empathy_score: 0,
      question_score: 0,
      ethics_score: 0,
      feedback_text:
        "Analisis otomatis gagal. Silakan minta feedback dari supervisor.",
      strengths: [],
      improvements: [],
    };
  }
}

// GET /api/sessions
router.get("/", async (req, res) => {
  try {
    const { user_id, patient_id, status } = req.query;

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
      .order("start_time", { ascending: false });

    if (user_id) {
      query = query.eq("user_id", user_id);
    }

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
    const { user_id, patient_id } = req.body;

    const { data: session, error } = await supabase
      .from("sessions")
      .insert([
        {
          user_id,
          patient_id,
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
      .single();

    if (error) throw error;

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
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
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
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

    // 1. Check if session exists and is completed
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("status, start_time, end_time")
      .eq("session_id", session_id)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
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

    // 4. Analyze with AI
    console.log(`📊 Analyzing session ${session_id}...`);
    const analysis = await analyzeSessionWithAI(transcripts);

    // 5. Save evaluation
    const { data: evaluation, error: evalError } = await supabase
      .from("session_evaluations")
      .insert([
        {
          session_id,
          empathy_score: analysis.empathy_score,
          question_score: analysis.question_score,
          ethics_score: analysis.ethics_score,
          feedback_text: analysis.feedback_text,
          strengths: analysis.strengths,
          improvements: analysis.improvements,
        },
      ])
      .select()
      .single();

    if (evalError) {
      throw evalError;
    }

    console.log(`✅ Session ${session_id} evaluated successfully`);

    res.json({
      success: true,
      message: "Evaluasi berhasil disimpan",
      evaluation,
    });
  } catch (err) {
    console.error("❌ Error analyzing session:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// GET /api/sessions/:session_id/evaluation
router.get("/:session_id/evaluation", async (req, res) => {
  try {
    const { session_id } = req.params;

    const { data, error } = await supabase
      .from("session_evaluations")
      .select("*")
      .eq("session_id", session_id)
      .single();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    if (!data) {
      return res.json({
        success: true,
        evaluated: false,
        message: "Belum ada evaluasi untuk session ini",
      });
    }

    res.json({
      success: true,
      evaluated: true,
      evaluation: data,
    });
  } catch (err) {
    console.error("❌ Error fetching evaluation:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

export default router;

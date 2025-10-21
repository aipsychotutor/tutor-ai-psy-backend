import express from "express";
import { supabase } from "../supabase.js";

const router = express.Router();

// 📋 GET /api/sessions/:session_id/transcripts
router.get("/api/sessions/:session_id/transcripts", async (req, res) => {
  try {
    const { session_id } = req.params;

    const { data, error } = await supabase
      .from("session_transcripts")
      .select("*")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching transcripts:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📊 GET /api/sessions/:session_id/evaluation
router.get("/api/sessions/:session_id/evaluation", async (req, res) => {
  try {
    const { session_id } = req.params;

    const { data, error } = await supabase
      .from("session_evaluations")
      .select("*")
      .eq("session_id", session_id)
      .single();

    if (error && error.code !== "PGRST116") throw error;

    if (!data) {
      return res.json({
        session_id,
        empathy_score: 0,
        question_score: 0,
        ethics_score: 0,
        feedback_text: null,
        evaluated: false,
      });
    }

    res.json({ ...data, evaluated: true });
  } catch (err) {
    console.error("❌ Error fetching evaluation:", err);
    res.status(500).json({ error: err.message });
  }
});

// 💾 POST /api/sessions/:session_id/evaluation
router.post("/api/sessions/:session_id/evaluation", async (req, res) => {
  try {
    const { session_id } = req.params;
    const { empathy_score, question_score, ethics_score, feedback_text } = req.body;

    // Validasi nilai
    if (empathy_score && (empathy_score < 0 || empathy_score > 100)) {
      return res.status(400).json({ error: "empathy_score harus antara 0-100" });
    }
    if (question_score && (question_score < 0 || question_score > 100)) {
      return res.status(400).json({ error: "question_score harus antara 0-100" });
    }
    if (ethics_score && (ethics_score < 0 || ethics_score > 100)) {
      return res.status(400).json({ error: "ethics_score harus antara 0-100" });
    }

    // Cek apakah sudah ada
    const { data: existing } = await supabase
      .from("session_evaluations")
      .select("evaluation_id")
      .eq("session_id", session_id)
      .single();

    let result;

    if (existing) {
      const { data, error } = await supabase
        .from("session_evaluations")
        .update({
          empathy_score: empathy_score || 0,
          question_score: question_score || 0,
          ethics_score: ethics_score || 0,
          feedback_text: feedback_text || null,
        })
        .eq("session_id", session_id)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from("session_evaluations")
        .insert([
          {
            session_id,
            empathy_score: empathy_score || 0,
            question_score: question_score || 0,
            ethics_score: ethics_score || 0,
            feedback_text: feedback_text || null,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    res.json({
      success: true,
      message: "Evaluasi berhasil disimpan",
      data: result,
    });
  } catch (err) {
    console.error("❌ Error saving evaluation:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📈 GET /api/sessions/patient/:patient_id/report
router.get("/api/sessions/patient/:patient_id/report", async (req, res) => {
  try {
    const { patient_id } = req.params;
    const { user_id } = req.query;

    let query = supabase
      .from("sessions")
      .select(`
        session_id,
        user_id,
        patient_id,
        start_time,
        end_time,
        status,
        session_evaluations (
          empathy_score,
          question_score,
          ethics_score,
          feedback_text,
          created_at
        )
      `)
      .eq("patient_id", patient_id)
      .order("start_time", { ascending: false });

    if (user_id) query = query.eq("user_id", user_id);

    const { data: sessions, error } = await query;
    if (error) throw error;

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter((s) => s.status === "finished").length;
    const evaluatedSessions = sessions.filter((s) => s.session_evaluations);

    let averageScores = { empathy: 0, question: 0, ethics: 0, overall: 0 };

    if (evaluatedSessions.length > 0) {
      const totals = evaluatedSessions.reduce(
        (acc, s) => {
          const e = s.session_evaluations;
          acc.empathy += e.empathy_score || 0;
          acc.question += e.question_score || 0;
          acc.ethics += e.ethics_score || 0;
          return acc;
        },
        { empathy: 0, question: 0, ethics: 0 }
      );

      averageScores.empathy = Math.round(totals.empathy / evaluatedSessions.length);
      averageScores.question = Math.round(totals.question / evaluatedSessions.length);
      averageScores.ethics = Math.round(totals.ethics / evaluatedSessions.length);
      averageScores.overall = Math.round(
        (averageScores.empathy + averageScores.question + averageScores.ethics) / 3
      );
    }

    res.json({
      patient_id,
      totalSessions,
      completedSessions,
      evaluatedSessions: evaluatedSessions.length,
      averageScores,
      sessions: sessions.map((s) => ({
        session_id: s.session_id,
        start_time: s.start_time,
        end_time: s.end_time,
        status: s.status,
        hasEvaluation: !!s.session_evaluations,
        scores: s.session_evaluations || null,
      })),
    });
  } catch (err) {
    console.error("❌ Error fetching patient report:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📊 GET /api/sessions/user/:user_id/statistics
router.get("/api/sessions/user/:user_id/statistics", async (req, res) => {
  try {
    const { user_id } = req.params;

    const { data: sessions, error } = await supabase
      .from("sessions")
      .select(`
        session_id,
        status,
        start_time,
        end_time,
        session_evaluations (
          empathy_score,
          question_score,
          ethics_score
        )
      `)
      .eq("user_id", user_id);

    if (error) throw error;

    const stats = {
      totalSessions: sessions.length,
      completedSessions: sessions.filter((s) => s.status === "finished").length,
      ongoingSessions: sessions.filter((s) => s.status === "ongoing").length,
      evaluatedSessions: sessions.filter((s) => s.session_evaluations).length,
      totalHours: 0,
      averageScores: { empathy: 0, question: 0, ethics: 0, overall: 0 },
    };

    const completedWithTime = sessions.filter((s) => s.end_time && s.start_time);
    if (completedWithTime.length > 0) {
      const totalMinutes = completedWithTime.reduce((acc, s) => {
        const duration = new Date(s.end_time) - new Date(s.start_time);
        return acc + duration / (1000 * 60);
      }, 0);
      stats.totalHours = Math.round((totalMinutes / 60) * 10) / 10;
    }

    const evaluated = sessions.filter((s) => s.session_evaluations);
    if (evaluated.length > 0) {
      const totals = evaluated.reduce(
        (acc, s) => {
          const e = s.session_evaluations;
          acc.empathy += e.empathy_score || 0;
          acc.question += e.question_score || 0;
          acc.ethics += e.ethics_score || 0;
          return acc;
        },
        { empathy: 0, question: 0, ethics: 0 }
      );

      stats.averageScores.empathy = Math.round(totals.empathy / evaluated.length);
      stats.averageScores.question = Math.round(totals.question / evaluated.length);
      stats.averageScores.ethics = Math.round(totals.ethics / evaluated.length);
      stats.averageScores.overall = Math.round(
        (stats.averageScores.empathy + stats.averageScores.question + stats.averageScores.ethics) / 3
      );
    }

    res.json(stats);
  } catch (err) {
    console.error("❌ Error fetching user statistics:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
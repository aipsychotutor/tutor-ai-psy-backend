import express from "express";

import PatientModel from "../models/patientModel.js"; 
import SessionModel from "../models/sessionModel.js";
import SessionTranscriptModel from "../models/sessionTranscriptModel.js";
import SessionEvaluationModel from "../models/sessionEvaluationModel.js";

import { analyzeSession, PYTHON_API_URL } from "../services/analysisService.js";

const router = express.Router();

router.get("/transcripts/:session_id", async (req, res) => {
  try {
    const { session_id } = req.params;
    const user_id = req.user.user_id;

    await SessionModel.checkSessionAccess(session_id, user_id);

    const data = await SessionTranscriptModel.getTranscriptsBySessionId(session_id);

    res.json(data);
  } catch (err) {
    if (err.message.includes("Sesi tidak ditemukan")) {
        return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get("/evaluation/:session_id", async (req, res) => {
  try {
    const { session_id } = req.params;
    const user_id = req.user.user_id;

    await SessionModel.checkSessionAccess(session_id, user_id);

    const data = await SessionEvaluationModel.getEvaluationBySessionId(session_id);

    if (!data) {
      return res.json({
        session_id,
        user_id: user_id,
        empathy_score: 0,
        question_score: 0,
        feedback_text: null,
        evaluated: false,
      });
    }

    res.json({ ...data, evaluated: true });
  } catch (err) {
    if (err.message.includes("Sesi tidak ditemukan")) {
        return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post("/evaluation/:session_id", async (req, res) => {
  try {
    const { session_id } = req.params;
    const user_id = req.user.user_id;
    const { empathy_score, question_score, feedback_text } =
      req.body;

    await SessionModel.checkSessionAccess(session_id, user_id);

    // Validasi nilai
    if (empathy_score && (empathy_score < 0 || empathy_score > 100)) {
      return res
        .status(400)
        .json({ error: "empathy_score harus antara 0-100" });
    }
    if (question_score && (question_score < 0 || question_score > 100)) {
      return res
        .status(400)
        .json({ error: "question_score harus antara 0-100" });
    }

    // Cek apakah sudah ada
    const result = await SessionEvaluationModel.saveSessionEvaluation({
        session_id: session_id,
        empathy_score: empathy_score || 0,
        question_score: question_score || 0,
        feedback_text: feedback_text || null,
    });

    res.json({
      success: true,
      message: "Evaluasi berhasil disimpan",
      data: result,
    });
  } catch (err) {
    if (err.message.includes("Sesi tidak ditemukan")) {
        return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/patient/:patient_id", async (req, res) => {
  try {
    const { patient_id } = req.params;
    const user_id = req.user.user_id;

    await PatientModel.getPatientById(patient_id, user_id, req.user.role);

    const sessions = await SessionModel.getSessionsByPatientIdWithEvaluation(patient_id, user_id);

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(
      (s) => s.status === "finished"
    ).length;
    const evaluatedSessions = sessions.filter((s) => s.session_evaluations);

    let averageScores = { empathy: 0, question: 0, ethics: 0, overall: 0 };

    if (evaluatedSessions.length > 0) {
      const totals = evaluatedSessions.reduce(
        (acc, s) => {
          const e = s.session_evaluations;
          acc.empathy += e.empathy_score || 0;
          acc.question += e.question_score || 0;
          return acc;
        },
        { empathy: 0, question: 0, ethics: 0 }
      );

      averageScores.empathy = Math.round(
        totals.empathy / evaluatedSessions.length
      );
      averageScores.question = Math.round(
        totals.question / evaluatedSessions.length
      );
      averageScores.ethics = Math.round(
        totals.ethics / evaluatedSessions.length
      );
      averageScores.overall = Math.round(
        (averageScores.empathy +
          averageScores.question +
          averageScores.ethics) /
          3
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
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/me/statistics", async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const sessions = await SessionModel.getSessionsWithEvaluationsByUserId(user_id);

    const stats = {
      totalSessions: sessions.length,
      completedSessions: sessions.filter((s) => s.status === "finished").length,
      ongoingSessions: sessions.filter((s) => s.status === "ongoing").length,
      evaluatedSessions: sessions.filter((s) => s.session_evaluations).length,
      totalHours: 0,
      averageScores: { empathy: 0, question: 0, ethics: 0, overall: 0 },
    };

    const completedWithTime = sessions.filter(
      (s) => s.end_time && s.start_time
    );
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

      stats.averageScores.empathy = Math.round(
        totals.empathy / evaluated.length
      );
      stats.averageScores.question = Math.round(
        totals.question / evaluated.length
      );
      stats.averageScores.ethics = Math.round(totals.ethics / evaluated.length);
      stats.averageScores.overall = Math.round(
        (stats.averageScores.empathy +
          stats.averageScores.question +
          stats.averageScores.ethics) /
          3
      );
    }

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const evaluations = await SessionEvaluationModel.getEvaluationsByUserId(user_id);
    const evaluatedSessions = evaluations;
    const totalEvaluations = evaluations.length;

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

     // Hitung total skor 
     const sumScores = evaluatedSessions.reduce(
        (acc, evalData) => {
            const empathy = Number(evalData.empathy_score ?? 0);
            const question = Number(evalData.question_score ?? 0);

            acc.totalEmpathy += empathy;
            acc.totalQuestion += question;

            return acc;
        },
        { totalEmpathy: 0, totalQuestion: 0 }
    );

    const avg_empathy_score = sumScores.totalEmpathy / totalEvaluations;
    const avg_question_score = sumScores.totalQuestion / totalEvaluations;

    const final_avg_empathy = parseFloat(avg_empathy_score.toFixed(1));
    const final_avg_question = parseFloat(avg_question_score.toFixed(1));

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
    if (error.message.includes("Sesi tidak ditemukan")) {
        return res.status(404).json({ message: error.message });
    }
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data statistik: " + error.message,
    });
  }
});

router.post("/:session_id/analyze", async (req, res) => {
  try {
    const { session_id } = req.params;
    const user_id = req.user.user_id;
    const analysisResult = await analyzeSession(session_id, user_id);
    const { evaluation, modelAnalysis, prosodyAnalysis } = analysisResult;

    res.json({
      success: true,
      message: "Evaluasi berhasil disimpan",
      evaluation: evaluation,
      classification_results: modelAnalysis.results,
      detailed_analysis: {
        model_statistics: modelAnalysis.statistics,
        total_counselor_messages: modelAnalysis.total_messages,
        prosody_analysis: prosodyAnalysis,
        python_api_used: PYTHON_API_URL,
      },
    });
  } catch (err) {
    if (err.message.includes("Session belum selesai") || err.message.includes("sudah pernah dievaluasi") || err.message.includes("transkrip")) {
        return res.status(400).json({ success: false, message: err.message });
    }
    if (err.message.includes("tidak ditemukan") || err.message.includes("tidak punya akses")) {
        return res.status(404).json({ success: false, message: err.message });
    }
    res.status(500).json({
      success: false,
      message: err.message,
      details: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
});

export default router;
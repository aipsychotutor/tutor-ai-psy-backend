import express from "express";
import SessionModel from "../models/sessionModel.js";
import PatientModel from "../models/patientModel.js";
import SessionFaceEvaluationModel from "../models/sessionFaceEvaluationModel.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { patient_id, status } = req.query;
    const user_id = req.user.user_id;

    const sessions = await SessionModel.getAllSessions(user_id, {
      patient_id: patient_id,
      status: status,
    });

    const formattedSessions = sessions.map((s) => {
      return {
        session_id: s.session_id,
        patient_id: s.patient_id,
        patient_name: s.patients?.patient_name || "Unknown",
        patient_image: s.patients?.profile_image || null,
        start_time: s.start_time,
        end_time: s.end_time,
        symptom_intensity: s.patients?.symptom_intensity || null,
        status: s.status || "ongoing",
      };
    });

    res.json({
      success: true,
      data: formattedSessions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const { patient_id } = req.body;
    const user_id = req.user.user_id;

    try {
      await PatientModel.getPatientById(patient_id, user_id, req.user.role);
    } catch (err) {
      return res.status(404).json({
        success: false,
        message: "Patient tidak ditemukan atau Anda tidak punya akses.",
      });
    }

    const session = await SessionModel.createNewSession(user_id, patient_id);

    res.status(201).json({
      success: true,
      data: session,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.user_id;

    const session = await SessionModel.getSessionById(id, user_id);

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    if (
      error.message.includes("tidak ditemukan") ||
      error.message.includes("tidak punya akses")
    ) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.user_id;
    const { status, end_time, expression_data } = req.body;

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

    const postExpressionData =
      await SessionFaceEvaluationModel.createNewFaceEvaluation(
        id,
        expression_data || {}
      );
    const updatedSession = await SessionModel.updateSession(
      id,
      user_id,
      updateData
    );

    res.json({
      success: true,
      message: "Session berhasil diupdate",
      data: updatedSession,
      expression_data: postExpressionData,
    });
  } catch (error) {
    if (
      error.message.includes("tidak ditemukan") ||
      error.message.includes("tidak punya akses")
    ) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;

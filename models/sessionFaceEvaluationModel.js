import { supabase } from "../supabase.js";

// === CREATE ===
async function createNewFaceEvaluation(sessionId, expression) {
  const { data: evaluation, error } = await supabase
    .from("session_face_evaluations")
    .insert([
      {
        session_id: sessionId,
        expression: expression,
        created_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (error)
    throw new Error("Gagal membuat evaluasi wajah baru: " + error.message);
  return evaluation;
}

// === READ (Get all evaluations by sessionId) ===
async function getFaceEvaluationsBySessionId(sessionId) {
  const { data, error } = await supabase
    .from("session_face_evaluations")
    .select("session_id, expression, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (error)
    throw new Error(
      "Gagal mengambil evaluasi wajah untuk sesi: " + error.message
    );
  return data;
}

// === UPDATE ===
async function updateFaceEvaluation(sessionId, createdAt, updateData) {
  const { data, error } = await supabase
    .from("session_face_evaluations")
    .update(updateData)
    .eq("session_id", sessionId)
    .eq("created_at", createdAt)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      "Gagal memperbarui evaluasi wajah: Tidak ditemukan atau akses tidak diizinkan."
    );
  }
  return data;
}

// === DELETE ===
async function deleteFaceEvaluation(sessionId, createdAt) {
  const { data, error } = await supabase
    .from("session_face_evaluations")
    .delete()
    .eq("session_id", sessionId)
    .eq("created_at", createdAt);

  if (error || !data) {
    throw new Error(
      "Gagal menghapus evaluasi wajah: Tidak ditemukan atau akses tidak diizinkan."
    );
  }
  return data;
}

const SessionFaceEvaluationModel = {
  createNewFaceEvaluation,
  getFaceEvaluationsBySessionId,
  updateFaceEvaluation,
  deleteFaceEvaluation,
};

export default SessionFaceEvaluationModel;

import { supabase } from "../supabase.js";

// === HELPER: CHECK ACCESS ===
// Digunakan oleh rute laporan untuk memverifikasi kepemilikan sesi
async function checkSessionAccess(sessionId, userId) {
  const { data: session, error } = await supabase
    .from("sessions")
    .select("session_id")
    .eq("session_id", sessionId)
    .eq("user_id", userId) // Wajib user adalah pemilik sesi
    .single();

  // PGRST116 adalah kode untuk 'not found'
  if (error || !session) {
    throw new Error("Sesi tidak ditemukan atau Anda tidak punya akses.");
  }
  return true;
}

// === CREATE ===
async function createNewSession(userId, patientId) {
  const { data: session, error } = await supabase
    .from("sessions")
    .insert([
      {
        user_id: userId,
        patient_id: patientId,
        status: "ongoing",
      },
    ])
    .select()
    .single();

  if (error) throw new Error("Gagal membuat sesi baru: " + error.message);
  return session;
}

// === READ (List View) ===
async function getAllSessions(userId, queryFilters = {}) {
  let query = supabase
    .from("sessions")
    .select(
      `
              session_id, patient_id, start_time, end_time, status,
              patients (patient_name, profile_image, symptom_intensity)
            `
    )
    .order("start_time", { ascending: false })
    .eq("user_id", userId);

  if (queryFilters.patient_id)
    query = query.eq("patient_id", queryFilters.patient_id);
  if (queryFilters.status) query = query.eq("status", queryFilters.status);

  const { data, error } = await query;
  if (error) throw new Error("Gagal mengambil daftar sesi: " + error.message);
  return data;
}

// === READ (Detail View) ===
async function getSessionById(sessionId, userId) {
  const { data: session, error } = await supabase
    .from("sessions")
    .select(
      `
            *, 
            patients (patient_name, profile_image, age, gender)
        `
    )
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .single();

  if (error || !session) {
    throw new Error("Session tidak ditemukan atau Anda tidak punya akses.");
  }
  return session;
}

// === READ (Reports: Get all sessions for a patient with their evaluations) ===
async function getSessionsByPatientIdWithEvaluation(patientId, userId) {
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select(
      `
            session_id,
            user_id,
            patient_id,
            start_time,
            end_time,
            status,
            session_evaluations (
                empathy_score,
                question_score,
                feedback_text,
                created_at
            )
            `
    )
    .eq("patient_id", patientId)
    .eq("user_id", userId)
    .order("start_time", { ascending: false });

  if (error)
    throw new Error(
      "Gagal mengambil sesi pasien dengan evaluasi: " + error.message
    );
  return sessions;
}

// === READ (Reports: Get all sessions for a user with their evaluations for statistics) ===
async function getSessionsWithEvaluationsByUserId(userId) {
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select(
      `
            session_id,
            status,
            start_time,
            end_time,
            session_evaluations (
                empathy_score,
                question_score,
                ethics_score
            )
            `
    )
    .eq("user_id", userId);

  if (error)
    throw new Error(
      "Gagal mengambil sesi untuk statistik user: " + error.message
    );
  return sessions;
}

// === UPDATE ===
async function updateSession(sessionId, userId, updateData) {
  const { data, error } = await supabase
    .from("sessions")
    .update(updateData)
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      "Gagal update sesi: Session tidak ditemukan atau Anda tidak punya akses."
    );
  }
  return data;
}

const SessionModel = {
  checkSessionAccess,
  createNewSession,
  getAllSessions,
  getSessionById,
  updateSession,
  getSessionsByPatientIdWithEvaluation,
  getSessionsWithEvaluationsByUserId,
};

export default SessionModel;

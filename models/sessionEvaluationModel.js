import { supabase } from "../supabase.js";

// === CREATE / UPSERT (Membuat atau Memperbarui) ===
// Dipanggil oleh AnalysisService setelah skor dihitung.
async function saveSessionEvaluation(evaluationData) {
    // Karena session_id adalah UNIQUE di tabel ini, kita bisa menggunakan upsert
    // untuk memastikan hanya ada satu evaluasi per sesi.
    const { data: evaluation, error: evalError } = await supabase
        .from("session_evaluations")
        .upsert(evaluationData, { 
            onConflict: 'session_id', // Kunci untuk upsert
            ignoreDuplicates: false 
        })
        .select().single();

    if (evalError) throw new Error("Gagal menyimpan/memperbarui evaluasi: " + evalError.message);
    return evaluation;
}

// === READ ===

// Mengambil data evaluasi untuk sesi tertentu
async function getEvaluationBySessionId(sessionId) {
    const { data, error } = await supabase
        .from("session_evaluations")
        .select(`*`)
        .eq("session_id", sessionId)
        .single();
    
    // PGRST116 = tidak ditemukan (ini normal jika belum dievaluasi)
    if (error && error.code !== "PGRST116") throw new Error("Gagal mengambil data evaluasi.");
    return data; // Akan return null jika tidak ada
}

// Mengecek apakah evaluasi sudah ada (untuk rute POST /analyze)
async function getExistingEvaluation(sessionId) {
     const { data: existingEval } = await supabase
        .from("session_evaluations")
        .select("evaluation_id")
        .eq("session_id", sessionId)
        .single();
    return existingEval;
}

// Mengambil skor rata-rata untuk statistik user
async function getEvaluationsByUserId(userId) {
    const { data: evaluations, error: evalError } = await supabase
      .from("session_evaluations")
      .select(`
          empathy_score,
          question_score,
          ethics_score,
          sessions!inner(user_id) // Menggunakan join untuk filter
      `)
      .filter('sessions.user_id', 'eq', userId);
        
    if (evalError) throw new Error("Gagal mengambil evaluasi untuk statistik: " + evalError.message);
    return evaluations;
}

const SessionEvaluationModel = {
    saveSessionEvaluation,
    getEvaluationBySessionId,
    getExistingEvaluation,
    getEvaluationsByUserId,
};

export default SessionEvaluationModel;
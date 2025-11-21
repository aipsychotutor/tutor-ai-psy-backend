import { supabase } from "../supabase.js";

// === CREATE ===
// Menyimpan satu baris pesan (user atau pasien)
async function saveTranscript(sessionId, role, text, prosodyData = null) {
    const { data, error } = await supabase
        .from("session_transcripts")
        .insert([{
            session_id: sessionId,
            message_role: role,
            message_text: text,
            prosody_data: prosodyData,
        }])
        .select()
        .single();

    if (error) throw new Error("Gagal menyimpan transkrip: " + error.message);
    return data;
}

// === READ ===
// Mengambil semua transkrip untuk sesi tertentu (untuk tampilan chat atau analisis)
async function getTranscriptsBySessionId(sessionId) {
    const { data, error } = await supabase
        .from("session_transcripts")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true }); // Penting untuk urutan

    if (error) throw new Error("Gagal mengambil transkrip: " + error.message);
    return data;
}

const SessionTranscriptModel = {
    saveTranscript,
    getTranscriptsBySessionId,
};

export default SessionTranscriptModel;
import { supabase } from "../supabase.js";

// Ambil semua pasien yang dapat diakses oleh user (Milik user atau Global)
async function getAllPatients(userId, userRole, selectColumns = '*') {
    
    let query = supabase.from("patients").select(selectColumns);

    if (userRole === "admin") {
        query = query.select(`*, users(username)`);
    } else {
        query = query.or(`user_id.eq.${userId},is_global.eq.true`);
    }
    
    query = query
        .eq('is_active', true)
        .order("patient_name", { ascending: true });

    const { data, error } = await query;
    
    if (error) {
        throw new Error("Gagal mengambil daftar pasien.");
    }
    return data;
}

// Ambil detail pasien dengan verifikasi hak akses
async function getPatientById(patientId, userId, userRole) {
    let accessCondition;
    
    if (userRole === 'admin') {
        // Admin bisa melihat pasien siapapun
        accessCondition = `patient_id.eq.${patientId}`;
    } else {
        // User biasa: milik user OR global
        accessCondition = `patient_id.eq.${patientId},and(user_id.eq.${userId},is_global.eq.true)`;
    }
    
    const { data, error } = await supabase
        .from("patients")
        .select(`*`)
        .or(accessCondition)
        .single();
    
    if (error || !data) {
        if (error?.code === 'PGRST116' || !data) {
            throw new Error("Pasien tidak ditemukan atau Anda tidak memiliki akses.");
        }
        throw new Error("Gagal mengambil detail pasien.");
    }
    return data;
}

// Ambil path avatar pasien
async function getPatientAvatarPath(patientId, userId) {
    const { data, error } = await supabase
        .from("patients")
        .select("avatar_path")
        .eq("patient_id", patientId)
        // Verifikasi hak akses: milik user atau global
        .or(`user_id.eq.${userId},is_global.eq.true`)
        .single();

    if (error) {
        throw new Error("Gagal mengambil path avatar.");
    }

    return data;
}

// Membuat pasien baru (CREATE)
async function createNewPatient(patientData) {
    const { data: newPatient, error } = await supabase
        .from("patients")
        .insert([patientData])
        .select()
        .single();

    if (error) {
        console.error("[PatientModel] createNewPatient DB error:", error);
        throw new Error(`Gagal menambahkan pasien ke database: ${error.message || error}`);
    }

    return newPatient;
}

// Update Knowledge Base (Hanya digunakan untuk migrasi)
async function updatePatientKnowledge(patientId, knowledgeBase) {
    const { error } = await supabase
        .from("patients")
        .update({ knowledge_base: knowledgeBase })
        .eq("patient_id", patientId);
    
    if (error) {
        throw new Error("Gagal update knowledge base pasien.");
    }
}

// Mengambil pasien yang memerlukan migrasi embedding (knowledge_base = null)
async function getPatientsNeedingMigration() {
    const { data: patients, error } = await supabase
        .from("patients")
        .select("*")
        .is("knowledge_base", null);
        
    if (error) throw new Error("Gagal mengambil data migrasi.");
    return patients;
}

// Memperbarui data pasien (UPDATE)
async function updatePatient(patientId, updateData) {
    const { data: updatedPatient, error } = await supabase
        .from("patients")
        .update({
            patient_name: updateData.patient_name,
            background_story: updateData.background_story,
            personality_type: updateData.personality_type || null,
            symptom_intensity: updateData.symptom_intensity || null,
            age: updateData.age || null,
            gender: updateData.gender || null,
            occupation: updateData.occupation || null,
            marital_status: updateData.marital_status || null,
            personality_traits: updateData.personality_traits || null,
            knowledge_base: updateData.knowledge_base, 
            update_at: new Date().toISOString(), // Manual update timestamp jika diperlukan
        })
        .eq("patient_id", patientId)
        .select()
        .single();

    if (error) {
        throw new Error("Gagal memperbarui data pasien di database.");
    }

    return updatedPatient;
}

// Menghapus pasien beserta seluruh data terkait (Sessions, Transcripts, Evaluations)
async function deletePatient(patientId) {
    // Ambil semua session_id yang berhubungan dengan patient_id ini
    const { data: sessions, error: sessionError } = await supabase
        .from("sessions")
        .select("session_id")
        .eq("patient_id", patientId);

    if (sessionError) throw new Error("Gagal mengambil data sesi pasien.");

    const sessionIds = sessions.map(s => s.session_id);

    if (sessionIds.length > 0) {
        // Hapus dari session_evaluations
        const { error: evalError } = await supabase
            .from("session_evaluations")
            .delete()
            .in("session_id", sessionIds);
        if (evalError) throw new Error("Gagal menghapus evaluasi sesi.");

        // Hapus dari session_transcripts
        const { error: transError } = await supabase
            .from("session_transcripts")
            .delete()
            .in("session_id", sessionIds);
        if (transError) throw new Error("Gagal menghapus transkrip sesi.");

        // Hapus dari sessions
        const { error: delSessionError } = await supabase
            .from("sessions")
            .delete()
            .eq("patient_id", patientId);
        if (delSessionError) throw new Error("Gagal menghapus sesi pasien.");
    }

    // hapus patient dari tabel patients
    const { error: patientError } = await supabase
        .from("patients")
        .delete()
        .eq("patient_id", patientId);

    if (patientError) throw new Error("Gagal menghapus data pasien.");

    return { success: true };
}

const PatientModel = { 
    getAllPatients, 
    getPatientById,
    getPatientAvatarPath,
    createNewPatient,
    updatePatientKnowledge,
    getPatientsNeedingMigration,
    updatePatient,
    deletePatient 
};

export default PatientModel;
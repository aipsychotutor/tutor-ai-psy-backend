import { supabase } from "../supabase.js";

// Ambil semua pasien yang dapat diakses oleh user (Milik user atau Global)
async function getAllPatients(userId, userRole, selectColumns = '*') {
    console.log(`DB: Fetching all patients for role=${userRole}, userId=${userId}`);
    
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
        console.error("DB Error getAllPatients:", error);
        throw new Error("Gagal mengambil daftar pasien.");
    }
    return data;
}

// Ambil detail pasien dengan verifikasi hak akses
async function getPatientById(patientId, userId, userRole) {
    console.log(`DB: Fetching patient ${patientId} for user ${userId} (Role: ${userRole})`);
    
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
        console.error("DB Error getPatientById:", error);
        throw new Error("Gagal mengambil detail pasien.");
    }
    return data;
}

// Ambil path avatar pasien
async function getPatientAvatarPath(patientId, userId) {
    console.log(`DB: Fetching avatar path for patient ${patientId}`);
    
    const { data, error } = await supabase
        .from("patients")
        .select("avatar_path")
        .eq("patient_id", patientId)
        // Verifikasi hak akses: milik user atau global
        .or(`user_id.eq.${userId},is_global.eq.true`)
        .single();

    if (error) {
        console.error("DB Error getPatientAvatarPath:", error);
        throw new Error("Gagal mengambil path avatar.");
    }

    return data;
}

// Membuat pasien baru (CREATE)
async function createNewPatient(patientData) {
    console.log(`DB: Creating new patient: ${patientData.patient_name}`);
    
    const { data: newPatient, error } = await supabase
        .from("patients")
        .insert([patientData])
        .select()
        .single();

    if (error) {
        console.error("DB Error createNewPatient:", error);
        throw new new Error("Gagal menambahkan pasien ke database.");
    }

    return newPatient;
}

// Update Knowledge Base (Hanya digunakan untuk migrasi)
async function updatePatientKnowledge(patientId, knowledgeBase) {
    console.log(`DB: Updating knowledge base for patient ${patientId}`);
    
    const { error } = await supabase
        .from("patients")
        .update({ knowledge_base: knowledgeBase })
        .eq("patient_id", patientId);
    
    if (error) {
        console.error("DB Error updatePatientKnowledge:", error);
        throw new Error("Gagal update knowledge base pasien.");
    }
}

// Mengambil pasien yang memerlukan migrasi embedding (knowledge_base = null)
async function getPatientsNeedingMigration() {
    console.log("DB: Fetching patients needing embedding migration...");
    
    const { data: patients, error } = await supabase
        .from("patients")
        .select("*")
        .is("knowledge_base", null);
        
    if (error) throw new Error("Gagal mengambil data migrasi.");
    return patients;
}


const PatientModel = { 
    getAllPatients, 
    getPatientById,
    getPatientAvatarPath,
    createNewPatient,
    updatePatientKnowledge,
    getPatientsNeedingMigration
};

export default PatientModel;
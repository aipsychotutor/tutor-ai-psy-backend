import express from "express";
import { getEmbedding } from "../services/geminiService.js";
import PatientModel from "../models/patientModel.js"; 

const router = express.Router();

// ==========================================
// HELPER: GENERATE EMBEDDINGS
// ==========================================
async function generatePatientEmbeddings(patientData) {
  console.log(`🔄 [EMBEDDING] Generating knowledge base for: ${patientData.patient_name}`);

  // 1. Gabungkan teks penting jadi satu string panjang
  // Kita gabung background, biodata (bikin manual stringnya), dan kepribadian
  const biodataText = `
    Nama: ${patientData.patient_name}
    Usia: ${patientData.age || "-"}
    Gender: ${patientData.gender || "-"}
    Pekerjaan: ${patientData.occupation || "-"}
    Status: ${patientData.marital_status || "-"}
  `;

  const fullText = [
    biodataText,
    patientData.background_story,
    patientData.personality_traits ? JSON.stringify(patientData.personality_traits) : ""
  ].filter(Boolean).join("\n\n");

  // 2. Pecah jadi potongan kalimat (Chunks)
  // Split berdasarkan baris baru atau titik. Filter yg kependekan.
  const chunks = fullText
    .split(/\n|\./)
    .map(s => s.trim())
    .filter(s => s.length > 20); // Hanya ambil kalimat > 20 huruf

  const knowledgeBase = [];

  // 3. Loop & Request Embedding ke Google
  for (const chunk of chunks) {
    const vector = await getEmbedding(chunk);
    if (vector) {
      knowledgeBase.push({
        text: chunk,
        vector: vector
      });
    }
  }

  console.log(`✅ [EMBEDDING] Done. Generated ${knowledgeBase.length} vectors.`);
  return knowledgeBase;
}

// ==========================================
// ROUTES
// ==========================================
// POST /api/patients/migrate-embeddings
router.post("/migrate-embeddings", async (req, res) => {
  try {
    console.log("🚀 [MIGRATE] Starting migration for existing patients...");

    const patients = await PatientModel.getPatientsNeedingMigration();

    console.log(`📦 Found ${patients.length} patients to migrate.`);
    let successCount = 0;

    for (const patient of patients) {
      const kb = await generatePatientEmbeddings(patient);

      if (kb.length > 0) {
        await PatientModel.updatePatientKnowledge(patient.patient_id, kb);
        
        successCount++;
      }
    }

    res.json({ 
      status: "success", 
      message: `Berhasil migrasi ${successCount} dari ${patients.length} pasien.` 
    });

  } catch (err) {
    console.error("Migration Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/patients/:id
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user?.user_id;
    if (!user_id) {
      return res
        .status(401)
        .json({ status: "error", message: "User not authenticated" });
    }

    console.log(`Fetching patient ${id} for user ${user_id}`);

    const patient = await PatientModel.getPatientById(id, user_id, req.user.role);

    console.log("Patient found:", patient);
    return res.json(patient);
  } catch (error) {
    console.error("Error fetching patient:", error);

    if (error.message.includes("Pasien tidak ditemukan")) {
      return res.status(404).json({
        status: "error",
        message: error.message,
      });
    }

    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

// GET /api/patients - Get all patients
router.get("/", async (req, res) => {
  const userRole = req.user.role;
  const user_id = req.user.user_id;
  try {
    const columns = "patient_id, patient_name, avatar_path, created_at, is_active, is_global, user_id"; 

    const patients = await PatientModel.getAllPatients(user_id, userRole, columns);
    
    return res.json(patients);
  } catch (error) {
    console.error("Error fetching patients:", error);
    return res.status(500).json({ status: "error", message: error.message });
  }
});

// POST /api/patients (CREATE NEW PATIENT)
router.post("/", async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const {
      patient_name,
      background_story,
      personality_type,
      symptom_intensity,
      age,
      gender,
      occupation,
      marital_status,
      personality_traits,
      is_global,
    } = req.body;

    // --- VALIDASI ---
    if (!patient_name || !background_story) {
      return res.status(400).json({ status: "error", message: "patient_name dan background_story harus diisi" });
    }
    if (symptom_intensity && (symptom_intensity < 1 || symptom_intensity > 10)) {
      return res.status(400).json({ status: "error", message: "symptom_intensity harus antara 1-10" });
    }
    if (age && age < 0) {
      return res.status(400).json({ status: "error", message: "age harus bernilai positif" });
    }

    // --- PERSIAPAN DATA ---
    const rawDataForEmbedding = {
        patient_name, age, gender, occupation, marital_status, 
        background_story, personality_traits
    };

    // GENERATE EMBEDDING (RAG)
    let knowledgeBase = null;
    try {
        knowledgeBase = await generatePatientEmbeddings(rawDataForEmbedding);
    } catch (embError) {
        console.error("⚠️ Warning: Failed to generate embeddings, proceeding without RAG data.", embError);
    }

    const patientData = {
      user_id: user_id,
      patient_name,
      background_story,
      personality_type: personality_type || null,
      symptom_intensity: symptom_intensity || null,
      age: age || null,
      gender: gender || null,
      occupation: occupation || null,
      marital_status: marital_status || null,
      personality_traits: personality_traits || null,
      avatar_path: "/models/default.glb",
      profile_image: null,
      is_active: true,
      is_global: is_global || false,
      knowledge_base: knowledgeBase //hasil vector
    };

    const newPatient = await PatientModel.createNewPatient(patientData);

    console.log("Patient created successfully ID:", newPatient.patient_id);

    return res.status(201).json({
      status: "success",
      message: "Pasien berhasil ditambahkan",
      data: newPatient,
    });
  } catch (error) {
    console.error("Error creating patient:", error);
    return res.status(500).json({ status: "error", message: error.message });
  }
});

// GET /api/patients/model/:patientId - Get patient avatar model path
router.get("/model/:patientId", async (req, res) => {
  try {
    const { patientId } = req.params;
    const user_id = req.user.user_id;
    console.log(`Fetching avatar for patient ${patientId} (user ${user_id})`);

    const data = await PatientModel.getPatientAvatarPath(patientId, user_id);

    if (!data || !data.avatar_path) {
      return res.json({ avatar_path: "/models/default.glb" });
    }

    res.json({ avatar_path: data.avatar_path });
  } catch (err) {
    console.error("Error fetching avatar:", err);
    if (err.message.includes("Pasien tidak ditemukan")) {
         return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;

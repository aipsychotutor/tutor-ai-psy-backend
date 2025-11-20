// ./routes/patients.js

import express from "express";
import { supabase } from "../supabase.js";
import { getEmbedding } from "../services/geminiService.js";

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

// 🚀 MIGRATION ENDPOINT (Solusi 1)
// Panggil ini sekali via Postman: POST /api/patients/migrate-embeddings
router.post("/migrate-embeddings", async (req, res) => {
  try {
    // Cek apakah user admin (Opsional, tapi disarankan)
    console.log("🚀 [MIGRATE] Starting migration for existing patients...");

    // 1. Ambil pasien yang knowledge_base-nya masih NULL
    const { data: patients, error } = await supabase
      .from("patients")
      .select("*")
      .is("knowledge_base", null);

    if (error) throw error;

    console.log(`📦 Found ${patients.length} patients to migrate.`);
    let successCount = 0;

    // 2. Loop update satu per satu
    for (const patient of patients) {
      // Generate embedding pakai helper di atas
      const kb = await generatePatientEmbeddings(patient);

      if (kb.length > 0) {
        await supabase
          .from("patients")
          .update({ knowledge_base: kb })
          .eq("patient_id", patient.patient_id);
        
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
      // Jika ini terjadi, middleware otentikasi bermasalah
      return res
        .status(401)
        .json({ status: "error", message: "User not authenticated" });
    }

    console.log(`Fetching patient ${id} for user ${user_id}`);

    // Query langsung ke Supabase
    const { data: patient, error } = await supabase
      .from("patients")
      .select("*")
      .eq("patient_id", id)
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return res.status(404).json({
        status: "error",
        message: "Patient not found or you do not have access",
      });
    }

    if (!patient) {
      console.log("Patient not found");
      return res.status(404).json({
        status: "error",
        message: "Patient not found",
      });
    }

    console.log("Patient found:", patient);
    return res.json(patient);
  } catch (error) {
    console.error("Error fetching patient:", error);
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

// GET /api/patients - Get all patients
router.get("/", async (req, res) => {
  const role = req.user.role;
  try {
    const user_id = req.user.user_id;

    // Jangan select column knowledge_base kalau list view (berat datanya)
    const columns = "patient_id, patient_name, avatar_path, created_at, is_active, is_global, user_id"; 

    const { data: patients, error } =
      role === "admin"
        ? await supabase.from("patients").select("*, users(username)") // Admin ambil semua
        : await supabase
            .from("patients")
            .select("*")
            .or(`user_id.eq.${user_id},is_global.eq.true`);

    if (error) throw error;

    return res.json(patients);
  } catch (error) {
    console.error("Error fetching patients:", error);
    return res.status(500).json({ status: "error", message: error.message });
  }
});

// router.get("/all", async (req, res) => {
//   try {
//     const user_id = req.user.user_id;
//     const { data: patients, error } = await supabase
//       .from("patients")
//       .select("*") // ambil semua pasien tanpa filter
//       .or(`user_id.eq.${user_id},is_global.eq.true`);

//     if (error) {
//       throw error;
//     }

//     return res.json(patients);
//   } catch (error) {
//     console.error("Error fetching all patients:", error);
//     return res.status(500).json({
//       status: "error",
//       message: error.message,
//     });
//   }
// });

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
    // Objek sementara untuk embedding generator
    const rawDataForEmbedding = {
        patient_name, age, gender, occupation, marital_status, 
        background_story, personality_traits
    };

    // 🔥 GENERATE EMBEDDING (RAG) DI SINI 🔥
    // Proses ini mungkin nambah 2-3 detik saat save, tapi bikin chat ngebut
    let knowledgeBase = null;
    try {
        knowledgeBase = await generatePatientEmbeddings(rawDataForEmbedding);
    } catch (embError) {
        console.error("⚠️ Warning: Failed to generate embeddings, proceeding without RAG data.", embError);
        // Kita biarkan lanjut save, nanti bisa dimigrasi ulang
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
      
      // 👇 SIMPAN HASIL VECTOR
      knowledge_base: knowledgeBase 
    };

    console.log("Creating patient with data:", patientData.patient_name);

    const { data: newPatient, error } = await supabase
      .from("patients")
      .insert([patientData])
      .select()
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ status: "error", message: "Gagal menambahkan pasien", error: error.message });
    }

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

// GET /api/patients/model/:patientId
// Di routes/patients.js - ganti endpoint model ini:
router.get("/model/:patientId", async (req, res) => {
  try {
    const { patientId } = req.params;
    const user_id = req.user.user_id;
    console.log(`Fetching avatar for patient ${patientId} (user ${user_id})`);

    const { data, error } = await supabase
      .from("patients")
      .select("avatar_path")
      .eq("patient_id", patientId)
      .or(`user_id.eq.${user_id},user_id.is.null`)
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return res.status(400).json({ error: error.message });
    }

    if (!data || !data.avatar_path) {
      // Ini tidak apa-apa, kirim saja path default
      return res.json({ avatar_path: "models/default.glb" });
    }

    // Return path aja tanpa full URL (misal: "models/default.glb")
    res.json({ avatar_path: data.avatar_path });
  } catch (err) {
    console.error("Error fetching avatar:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

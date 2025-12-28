import express from "express";
import { getEmbedding } from "../services/geminiService.js";
import PatientModel from "../models/patientModel.js";

const router = express.Router();

// ==========================================
// HELPER: GENERATE EMBEDDINGS
// ==========================================
async function generatePatientEmbeddings(patientData) {
  // ========== SYMPTOM INTENSITY CATEGORIZATION ==========
  const symptomIntensity = parseInt(patientData.symptom_intensity) || 0;

  let symptom_intensity_tag = "";

  if (symptomIntensity <= 3) {
    symptom_intensity_tag = "Mild";
  } else if (symptomIntensity <= 6) {
    symptom_intensity_tag = "Moderate";
  } else if (symptomIntensity <= 8) {
    symptom_intensity_tag = "Mod-Severe";
  } else {
    symptom_intensity_tag = "Severe";
  }
  // 1. Gabungkan teks penting jadi satu string panjang
  // Kita gabung background, biodata (bikin manual stringnya), dan kepribadian
  const biodataText = `
    Nama: ${patientData.patient_name}
    Usia: ${patientData.age || "-"}
    Gender: ${patientData.gender || "-"}
    Pekerjaan: ${patientData.occupation || "-"}
    Status: ${patientData.marital_status || "-"}
    symptom_intensity: ${patientData.symptom_intensity || "-"}
    sympton_tag: ${symptom_intensity_tag}
  `;

  const fullText = [
    biodataText,
    patientData.background_story,
    patientData.personality_traits
      ? JSON.stringify(patientData.personality_traits)
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // 2. Pecah jadi potongan kalimat (Chunks)
  // Split berdasarkan baris baru atau titik. Filter yg kependekan.
  const chunks = fullText
    .split(/\n|\./)
    .map((s) => s.trim())
    .filter((s) => s.length > 20); // Hanya ambil kalimat > 20 huruf

  const knowledgeBase = [];

  // 3. Loop & Request Embedding ke Google
  for (const chunk of chunks) {
    const vector = await getEmbedding(chunk);
    if (vector) {
      knowledgeBase.push({
        text: chunk,
        vector: vector,
      });
    }
  }

  return knowledgeBase;
}

// ROUTES
router.post("/migrate-embeddings", async (req, res) => {
  try {
    const patients = await PatientModel.getPatientsNeedingMigration();

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
      message: `Berhasil migrasi ${successCount} dari ${patients.length} pasien.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user?.user_id;
    if (!user_id) {
      return res
        .status(401)
        .json({ status: "error", message: "User not authenticated" });
    }

    const patient = await PatientModel.getPatientById(
      id,
      user_id,
      req.user.role
    );
    return res.json(patient);
  } catch (error) {
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

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.user_id;
    const userRole = req.user.role;

    // 1. Ambil data pasien asli untuk cek kepemilikan
    const existingPatient = await PatientModel.getPatientById(
      id,
      user_id,
      userRole
    );

    // 2. Cek Otorisasi: Jika bukan Admin DAN bukan pemilik pasien (user_id tidak cocok)
    if (userRole !== "admin" && existingPatient.user_id !== user_id) {
      return res.status(403).json({
        status: "error",
        message:
          "Akses ditolak: Anda hanya dapat mengubah pasien buatan sendiri.",
      });
    }

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

    // Validasi Input Dasar
    if (!patient_name || !background_story || !personality_type || !symptom_intensity || !age || !gender || !occupation || !marital_status) {
      return res.status(400).json({     
        status: "error",
        message: "Semua field kecuali personality_traits wajib diisi.",
      });
    }

    // Persiapan data untuk Embedding (RAG)
    const rawDataForEmbedding = {
      patient_name,
      age,
      gender,
      occupation,
      marital_status,
      background_story,
      personality_traits,
    };

    let knowledgeBase = null;
    try {
      knowledgeBase = await generatePatientEmbeddings(rawDataForEmbedding);
    } catch (embError) {
      return res
        .status(500)
        .json({ status: "error", message: "Gagal memperbarui AI Knowledge." });
    }

    const updatedData = {
      patient_name,
      background_story,
      personality_type: personality_type || null,
      symptom_intensity: symptom_intensity || null,
      age: age || null,
      gender: gender || null,
      occupation: occupation || null,
      marital_status: marital_status || null,
      personality_traits: personality_traits || null,
      is_global: userRole === "admin" ? is_global || false : false, // Hanya admin yang bisa set global
      knowledge_base: knowledgeBase,
    };

    const result = await PatientModel.updatePatient(id, updatedData);

    return res.json({
      status: "success",
      message: "Data pasien berhasil diperbarui",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.user_id;
    const userRole = req.user.role;

    // 1. Ambil data pasien untuk cek pemiliknya
    const patient = await PatientModel.getPatientById(id, user_id, userRole);

    // 2. Otorisasi: Admin bebas hapus, User biasa hanya boleh jika miliknya sendiri
    if (userRole !== "admin" && patient.user_id !== user_id) {
      return res.status(403).json({
        status: "error",
        message:
          "Akses ditolak: Anda tidak memiliki izin untuk menghapus pasien ini.",
      });
    }

    await PatientModel.deletePatient(id);

    res.json({
      status: "success",
      message: "Pasien berhasil dihapus secara permanen.",
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

router.get("/", async (req, res) => {
  const userRole = req.user.role;
  const user_id = req.user.user_id;
  try {
    const columns =
      "patient_id, patient_name, age, gender, marital_status, occupation, background_story, personality_type, symptom_intensity, personality_traits, avatar_path, created_at, is_active, is_global, user_id";

    const patients = await PatientModel.getAllPatients(
      user_id,
      userRole,
      columns
    );

    return res.json(patients);
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
});

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
    if (!patient_name || !background_story || !personality_type || !symptom_intensity || !age || !gender || !occupation || !marital_status) {
      return res.status(400).json({     
        status: "error",
        message: "Semua field kecuali personality_traits wajib diisi.",
      });
    }
    
    if (
      symptom_intensity &&
      (symptom_intensity < 1 || symptom_intensity > 10)
    ) {
      return res.status(400).json({
        status: "error",
        message: "symptom_intensity harus antara 1-10",
      });
    }
    if (age && age < 0) {
      return res
        .status(400)
        .json({ status: "error", message: "age harus bernilai positif" });
    }

    // --- PERSIAPAN DATA ---
    const rawDataForEmbedding = {
      patient_name,
      age,
      gender,
      occupation,
      marital_status,
      background_story,
      personality_traits,
    };

    // GENERATE EMBEDDING (RAG)
    let knowledgeBase = null;
    try {
      knowledgeBase = await generatePatientEmbeddings(rawDataForEmbedding);
    } catch (embError) {
      console.error(
        "⚠️ Warning: Failed to generate embeddings, proceeding without RAG data.",
        embError
      );
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
      knowledge_base: knowledgeBase, //hasil vector
    };

    const newPatient = await PatientModel.createNewPatient(patientData);

    return res.status(201).json({
      status: "success",
      message: "Pasien berhasil ditambahkan",
      data: newPatient,
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
});

router.get("/model/:patientId", async (req, res) => {
  try {
    const { patientId } = req.params;
    const user_id = req.user.user_id;

    const data = await PatientModel.getPatientAvatarPath(patientId, user_id);

    if (!data || !data.avatar_path) {
      return res.json({ avatar_path: "/models/default.glb" });
    }

    res.json({ avatar_path: data.avatar_path });
  } catch (err) {
    if (err.message.includes("Pasien tidak ditemukan")) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;

import express from "express";
import { getEmbedding } from "../services/geminiService.js";
import PatientModel from "../models/patientModel.js"; 

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Patients
 *     description: Endpoint untuk manajemen data pasien dan avatar
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Patient:
 *       type: object
 *       properties:
 *         patient_id:
 *           type: string
 *           format: uuid
 *           description: ID unik pasien
 *         user_id:
 *           type: string
 *           format: uuid
 *           description: ID user yang membuat pasien
 *         patient_name:
 *           type: string
 *           description: Nama pasien
 *           example: John Doe
 *         background_story:
 *           type: string
 *           description: Latar belakang dan riwayat pasien
 *           example: Pasien mengalami kecemasan sosial sejak masa remaja
 *         personality_type:
 *           type: string
 *           nullable: true
 *           description: Tipe kepribadian pasien
 *           example: Introvert
 *         symptom_intensity:
 *           type: integer
 *           nullable: true
 *           minimum: 1
 *           maximum: 10
 *           description: Tingkat intensitas gejala (1-10)
 *           example: 7
 *         age:
 *           type: integer
 *           nullable: true
 *           description: Usia pasien
 *           example: 25
 *         gender:
 *           type: string
 *           nullable: true
 *           description: Jenis kelamin pasien
 *           example: Male
 *         occupation:
 *           type: string
 *           nullable: true
 *           description: Pekerjaan pasien
 *           example: Software Engineer
 *         marital_status:
 *           type: string
 *           nullable: true
 *           description: Status pernikahan pasien
 *           example: Single
 *         personality_traits:
 *           type: object
 *           nullable: true
 *           description: Trait kepribadian dalam format JSON
 *           example: { "openness": 8, "conscientiousness": 7 }
 *         avatar_path:
 *           type: string
 *           description: Path file avatar 3D model
 *           example: /models/default.glb
 *         profile_image:
 *           type: string
 *           nullable: true
 *           description: URL gambar profil pasien
 *         is_active:
 *           type: boolean
 *           description: Status aktif pasien
 *           example: true
 *         is_global:
 *           type: boolean
 *           description: Apakah pasien dapat diakses oleh semua user
 *           example: false
 *         knowledge_base:
 *           type: array
 *           nullable: true
 *           description: Data embedding untuk RAG
 *           items:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *               vector:
 *                 type: array
 *                 items:
 *                   type: number
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Waktu pembuatan data
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Waktu update terakhir
 *     
 *     PatientInput:
 *       type: object
 *       required:
 *         - patient_name
 *         - background_story
 *       properties:
 *         patient_name:
 *           type: string
 *           description: Nama pasien
 *           example: John Doe
 *         background_story:
 *           type: string
 *           description: Latar belakang dan riwayat pasien
 *           example: Pasien mengalami kecemasan sosial sejak masa remaja
 *         personality_type:
 *           type: string
 *           nullable: true
 *           description: Tipe kepribadian pasien
 *           example: Introvert
 *         symptom_intensity:
 *           type: integer
 *           nullable: true
 *           minimum: 1
 *           maximum: 10
 *           description: Tingkat intensitas gejala (1-10)
 *           example: 7
 *         age:
 *           type: integer
 *           nullable: true
 *           minimum: 0
 *           description: Usia pasien
 *           example: 25
 *         gender:
 *           type: string
 *           nullable: true
 *           description: Jenis kelamin pasien
 *           example: Male
 *         occupation:
 *           type: string
 *           nullable: true
 *           description: Pekerjaan pasien
 *           example: Software Engineer
 *         marital_status:
 *           type: string
 *           nullable: true
 *           description: Status pernikahan pasien
 *           example: Single
 *         personality_traits:
 *           type: object
 *           nullable: true
 *           description: Trait kepribadian dalam format JSON
 *           example: { "openness": 8, "conscientiousness": 7 }
 *         is_global:
 *           type: boolean
 *           description: Apakah pasien dapat diakses oleh semua user
 *           example: false
 *     
 *     PatientListItem:
 *       type: object
 *       properties:
 *         patient_id:
 *           type: string
 *           format: uuid
 *         patient_name:
 *           type: string
 *         avatar_path:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *         is_active:
 *           type: boolean
 *         is_global:
 *           type: boolean
 *         user_id:
 *           type: string
 *           format: uuid
 *     
 *     AvatarResponse:
 *       type: object
 *       properties:
 *         avatar_path:
 *           type: string
 *           description: Path ke file avatar 3D model
 *           example: /models/default.glb
 *     
 *     MigrationResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           example: success
 *         message:
 *           type: string
 *           example: Berhasil migrasi 5 dari 5 pasien.
 */

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
/**
 * @swagger
 * /patients/migrate-embeddings:
 *   post:
 *     summary: Migrasi Embeddings untuk Pasien yang Sudah Ada
 *     description: Membuat ulang knowledge base (embeddings) untuk semua pasien yang belum memiliki data embedding. Berguna untuk migrasi data lama ke sistem RAG.
 *     tags: [Patients]
 *     responses:
 *       200:
 *         description: Migrasi berhasil diselesaikan
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MigrationResponse'
 *       500:
 *         description: Error saat melakukan migrasi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to generate embeddings
 */
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

/**
 * @swagger
 * /patients/{id}:
 *   get:
 *     summary: Mengambil Detail Pasien Berdasarkan ID
 *     description: Mendapatkan informasi lengkap pasien termasuk background, biodata, dan knowledge base. User hanya bisa akses pasien miliknya sendiri atau pasien global, kecuali admin.
 *     tags: [Patients]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: ID unik pasien
 *     responses:
 *       200:
 *         description: Data pasien berhasil diambil
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Patient'
 *       401:
 *         description: User tidak terautentikasi
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 message:
 *                   type: string
 *                   example: User not authenticated
 *       404:
 *         description: Pasien tidak ditemukan atau tidak memiliki akses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 message:
 *                   type: string
 *                   example: Pasien tidak ditemukan atau Anda tidak punya akses
 *       500:
 *         description: Error server internal
 */
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

/**
 * @swagger
 * /patients:
 *   get:
 *     summary: Mengambil Daftar Semua Pasien
 *     description: Mendapatkan daftar pasien yang dapat diakses oleh user. User biasa hanya melihat pasien miliknya dan pasien global. Admin dapat melihat semua pasien.
 *     tags: [Patients]
 *     responses:
 *       200:
 *         description: Daftar pasien berhasil diambil
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/PatientListItem'
 *       500:
 *         description: Error server internal
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 message:
 *                   type: string
 *                   example: Database connection failed
 */
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

/**
 * @swagger
 * /patients:
 *   post:
 *     summary: Membuat Pasien Baru
 *     description: Mendaftarkan pasien baru dengan informasi lengkap. Sistem akan otomatis membuat knowledge base (embeddings) menggunakan Google Generative AI untuk mendukung fitur RAG.
 *     tags: [Patients]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PatientInput'
 *     responses:
 *       201:
 *         description: Pasien berhasil dibuat
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *                   example: Pasien berhasil ditambahkan
 *                 data:
 *                   $ref: '#/components/schemas/Patient'
 *       400:
 *         description: Validasi input gagal
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 message:
 *                   type: string
 *                   example: patient_name dan background_story harus diisi
 *       500:
 *         description: Error server internal
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 message:
 *                   type: string
 *                   example: Failed to create patient
 */
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

/**
 * @swagger
 * /patients/model/{patientId}:
 *   get:
 *     summary: Mengambil Path Avatar 3D Pasien
 *     description: Mendapatkan lokasi file 3D model avatar pasien. Jika tidak ada avatar khusus, akan mengembalikan path default.
 *     tags: [Patients]
 *     parameters:
 *       - in: path
 *         name: patientId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: ID unik pasien
 *     responses:
 *       200:
 *         description: Path avatar berhasil diambil
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AvatarResponse'
 *       404:
 *         description: Pasien tidak ditemukan atau tidak memiliki akses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Pasien tidak ditemukan atau Anda tidak punya akses
 *       500:
 *         description: Error server internal
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Database query failed
 */
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

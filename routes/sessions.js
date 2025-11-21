import express from "express";
import SessionModel from "../models/sessionModel.js";
import PatientModel from "../models/patientModel.js";

const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Sessions
 *     description: Endpoint untuk manajemen sesi konseling
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Session:
 *       type: object
 *       properties:
 *         session_id:
 *           type: string
 *           format: uuid
 *           description: ID unik sesi
 *           example: 550e8400-e29b-41d4-a716-446655440000
 *         user_id:
 *           type: string
 *           format: uuid
 *           description: ID konselor yang melakukan sesi
 *           example: 123e4567-e89b-12d3-a456-426614174000
 *         patient_id:
 *           type: string
 *           format: uuid
 *           description: ID pasien dalam sesi
 *           example: 789e0123-e45b-67d8-a901-234567890abc
 *         start_time:
 *           type: string
 *           format: date-time
 *           description: Waktu mulai sesi
 *           example: 2024-01-15T10:30:00Z
 *         end_time:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Waktu selesai sesi (null jika masih ongoing)
 *           example: 2024-01-15T11:30:00Z
 *         status:
 *           type: string
 *           enum: [ongoing, completed, cancelled]
 *           description: Status sesi saat ini
 *           example: ongoing
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Waktu pembuatan data
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Waktu update terakhir
 *     
 *     SessionWithPatient:
 *       type: object
 *       properties:
 *         session_id:
 *           type: string
 *           format: uuid
 *           example: 550e8400-e29b-41d4-a716-446655440000
 *         patient_id:
 *           type: string
 *           format: uuid
 *           example: 789e0123-e45b-67d8-a901-234567890abc
 *         patient_name:
 *           type: string
 *           description: Nama pasien
 *           example: John Doe
 *         patient_image:
 *           type: string
 *           nullable: true
 *           description: URL gambar profil pasien
 *           example: https://example.com/images/patient.jpg
 *         start_time:
 *           type: string
 *           format: date-time
 *           example: 2024-01-15T10:30:00Z
 *         end_time:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: 2024-01-15T11:30:00Z
 *         status:
 *           type: string
 *           enum: [ongoing, completed, cancelled]
 *           example: ongoing
 *     
 *     SessionCreateInput:
 *       type: object
 *       required:
 *         - patient_id
 *       properties:
 *         patient_id:
 *           type: string
 *           format: uuid
 *           description: ID pasien untuk sesi baru
 *           example: 789e0123-e45b-67d8-a901-234567890abc
 *     
 *     SessionUpdateInput:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [ongoing, completed, cancelled]
 *           description: Status baru sesi
 *           example: completed
 *         end_time:
 *           type: string
 *           format: date-time
 *           description: Waktu selesai sesi (biasanya diisi saat status = completed)
 *           example: 2024-01-15T11:30:00Z
 *     
 *     SessionListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SessionWithPatient'
 *     
 *     SessionResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           $ref: '#/components/schemas/Session'
 *     
 *     SessionUpdateResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: Session berhasil diupdate
 *         data:
 *           $ref: '#/components/schemas/Session'
 *     
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: Session tidak ditemukan atau Anda tidak punya akses
 */

/**
 * @swagger
 * /sessions:
 *   get:
 *     summary: Mengambil Daftar Sesi Konseling
 *     description: Mendapatkan semua sesi konseling yang dimiliki oleh user yang sedang login. Dapat difilter berdasarkan patient_id atau status.
 *     tags: [Sessions]
 *     parameters:
 *       - in: query
 *         name: patient_id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: false
 *         description: Filter sesi berdasarkan ID pasien tertentu
 *         example: 789e0123-e45b-67d8-a901-234567890abc
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ongoing, completed, cancelled]
 *         required: false
 *         description: Filter sesi berdasarkan status
 *         example: ongoing
 *     responses:
 *       200:
 *         description: Daftar sesi berhasil diambil
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionListResponse'
 *       500:
 *         description: Error server internal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/", async (req, res) => {
  try {
    const { patient_id, status } = req.query;
    const user_id = req.user.user_id;

    const sessions = await SessionModel.getAllSessions(user_id, {
        patient_id: patient_id,
        status: status,
    })

    const formattedSessions = sessions.map((s) => {
      return {
        session_id: s.session_id,
        patient_id: s.patient_id,
        patient_name: s.patients?.patient_name || "Unknown",
        patient_image: s.patients?.profile_image || null,
        start_time: s.start_time,
        end_time: s.end_time,
        status: s.status || "ongoing",
      };
    });

    res.json({
      success: true,
      data: formattedSessions,
    });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /sessions:
 *   post:
 *     summary: Membuat Sesi Konseling Baru
 *     description: Memulai sesi konseling baru dengan pasien tertentu. Sistem akan memverifikasi akses user terhadap pasien sebelum membuat sesi.
 *     tags: [Sessions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SessionCreateInput'
 *     responses:
 *       201:
 *         description: Sesi berhasil dibuat
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionResponse'
 *       404:
 *         description: Pasien tidak ditemukan atau user tidak memiliki akses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Patient tidak ditemukan atau Anda tidak punya akses.
 *       500:
 *         description: Error server internal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/", async (req, res) => {
  try {
    const { patient_id } = req.body;
    const user_id = req.user.user_id;

    try {
        await PatientModel.getPatientById(patient_id, user_id, req.user.role);
    } catch (err) {
        return res.status(404).json({
            success: false,
            message: "Patient tidak ditemukan atau Anda tidak punya akses.",
        });
    }

    const session = await SessionModel.createNewSession(user_id, patient_id);

    res.status(201).json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Error creating session:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /sessions/{id}:
 *   get:
 *     summary: Mengambil Detail Sesi Berdasarkan ID
 *     description: Mendapatkan informasi lengkap sesi konseling tertentu. User hanya bisa mengakses sesi miliknya sendiri.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: ID unik sesi
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     responses:
 *       200:
 *         description: Detail sesi berhasil diambil
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionResponse'
 *       404:
 *         description: Sesi tidak ditemukan atau user tidak memiliki akses
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Error server internal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.user_id;

    const session = await SessionModel.getSessionById(id, user_id);

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Error fetching session:", error);
    if (error.message.includes("tidak ditemukan") || error.message.includes("tidak punya akses")) {
        return res.status(404).json({
            success: false,
            message: error.message,
        });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /sessions/{id}:
 *   patch:
 *     summary: Memperbarui Status atau Waktu Selesai Sesi
 *     description: Mengupdate informasi sesi seperti status (ongoing/completed/cancelled) dan waktu selesai. Biasanya digunakan untuk menandai sesi selesai.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: ID unik sesi yang akan diupdate
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SessionUpdateInput'
 *           examples:
 *             markCompleted:
 *               summary: Menandai sesi selesai
 *               value:
 *                 status: completed
 *                 end_time: "2024-01-15T11:30:00Z"
 *             cancelSession:
 *               summary: Membatalkan sesi
 *               value:
 *                 status: cancelled
 *     responses:
 *       200:
 *         description: Sesi berhasil diupdate
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SessionUpdateResponse'
 *       400:
 *         description: Validasi input gagal (status tidak valid)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Status harus salah satu dari ongoing, completed, cancelled
 *       404:
 *         description: Sesi tidak ditemukan atau user tidak memiliki akses
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Error server internal
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.user_id;
    const { status, end_time } = req.body;

    const validStatuses = ["ongoing", "completed", "cancelled"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status harus salah satu dari: ${validStatuses.join(", ")}`,
      });
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (end_time) updateData.end_time = end_time;

    const updatedSession = await SessionModel.updateSession(id, user_id, updateData);

    res.json({
      success: true,
      message: "Session berhasil diupdate",
      data: updatedSession,
    });
  } catch (error) {
    console.error("Error updating session:", error);
    if (error.message.includes("tidak ditemukan") || error.message.includes("tidak punya akses")) {
        return res.status(404).json({
            success: false,
            message: error.message,
        });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
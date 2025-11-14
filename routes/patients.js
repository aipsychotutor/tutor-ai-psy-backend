// ./routes/patients.js

import express from "express";
import { supabase } from "../supabase.js";

const router = express.Router();

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

    const { data: patients, error } =
      role === "admin"
        ? await supabase.from("patients").select("*, users(username)")
        : await supabase
            .from("patients")
            .select("*")
            .or(`user_id.eq.${user_id},is_global.eq.true`)
            .eq("is_active", true);
    if (error) {
      throw error;
    }

    return res.json(patients);
  } catch (error) {
    console.error("Error fetching patients:", error);
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
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

    if (!patient_name || !background_story) {
      return res.status(400).json({
        status: "error",
        message: "patient_name dan background_story harus diisi",
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
      return res.status(400).json({
        status: "error",
        message: "age harus bernilai positif",
      });
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
      avatar_path: "models/default.glb",
      profile_image: null,
      is_active: true,
      is_global: is_global || false,
    };

    console.log("Creating patient with data:", patientData);

    const { data: newPatient, error } = await supabase
      .from("patients")
      .insert([patientData])
      .select()
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({
        status: "error",
        message: "Gagal menambahkan pasien",
        error: error.message,
      });
    }

    console.log("Patient created successfully:", newPatient);

    return res.status(201).json({
      status: "success",
      message: "Pasien berhasil ditambahkan",
      data: newPatient,
    });
  } catch (error) {
    console.error("Error creating patient:", error);
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
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

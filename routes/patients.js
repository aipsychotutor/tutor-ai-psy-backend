// ./routes/patients.js

import express from "express";
import { supabase } from "../supabase.js";

const router = express.Router();

// GET /api/patients/:id
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log("Fetching patient with ID:", id);

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
        message: "Patient not found",
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
  try {
    const { data: patients, error } = await supabase
      .from("patients")
      .select("*")
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

router.get("/all", async (req, res) => {
  try {
    const { data: patients, error } = await supabase
      .from("patients")
      .select("*"); // ambil semua pasien tanpa filter

    if (error) {
      throw error;
    }

    return res.json(patients);
  } catch (error) {
    console.error("Error fetching all patients:", error);
    return res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

router.post("/", async (req, res) => {
  try {
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
    console.log("Fetching avatar for patient:", patientId);

    const { data, error } = await supabase
      .from("patients")
      .select("avatar_path")
      .eq("patient_id", patientId)
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return res.status(400).json({ error: error.message });
    }

    if (!data || !data.avatar_path) {
      return res.status(404).json({ message: "Avatar path not found" });
    }

    // Return path aja tanpa full URL (misal: "models/default.glb")
    res.json({ avatar_path: data.avatar_path });
  } catch (err) {
    console.error("Error fetching avatar:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

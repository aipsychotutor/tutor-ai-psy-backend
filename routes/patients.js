// routes/patients.js
import express from 'express';
import { supabase } from '../supabase.js';

const router = express.Router();

// GET /api/patients/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('Fetching patient with ID:', id);

    // Query langsung ke Supabase
    const { data: patient, error } = await supabase
      .from('patients')
      .select('*')
      .eq('patient_id', id)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(404).json({
        status: 'error',
        message: 'Patient not found'
      });
    }

    if (!patient) {
      console.log('Patient not found');
      return res.status(404).json({
        status: 'error',
        message: 'Patient not found'
      });
    }

    console.log('Patient found:', patient);
    return res.json(patient);
  } catch (error) {
    console.error('Error fetching patient:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// GET /api/patients - Get all patients
router.get('/', async (req, res) => {
  try {
    const { data: patients, error } = await supabase
      .from('patients')
      .select('*')
      .eq('is_active', true);

    if (error) {
      throw error;
    }

    return res.json(patients);
  } catch (error) {
    console.error('Error fetching patients:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

router.get('/all', async (req, res) => {
  try {
    const { data: patients, error } = await supabase
      .from('patients')
      .select('*'); // ambil semua pasien tanpa filter

    if (error) {
      throw error;
    }

    return res.json(patients);
  } catch (error) {
    console.error('Error fetching all patients:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message
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
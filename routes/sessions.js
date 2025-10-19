import express from 'express';
import { supabase } from '../supabase.js';

const router = express.Router();

// Middleware untuk parse sendBeacon requests
router.use(express.text({ type: 'text/plain' }));

// GET /api/sessions?user_id=xxx - Get session history
router.get('/', async (req, res) => {
  try {
    const { user_id } = req.query;

    let query = supabase
      .from('sessions')
      .select(`
        session_id,
        patient_id,
        start_time,
        end_time,
        status,
        patients (
          patient_name,
          profile_image
        )
      `)
      .order('start_time', { ascending: false });

    if (user_id) {
      query = query.eq('user_id', user_id);
    }

    const { data: sessions, error } = await query;

    if (error) throw error;

    const formattedSessions = sessions.map(s => {
      let duration = null;
      if (s.start_time && s.end_time) {
        const start = new Date(s.start_time);
        const end = new Date(s.end_time);
        duration = Math.round((end - start) / 1000 / 60);
      }

     // Debug log untuk cek data
      console.log('Session data:', {
        session_id: s.session_id,
        patient_id: s.patient_id,
        patient_name: s.patients?.patient_name,
        full_patients_data: s.patients
      });

      return {
        session_id: s.session_id,
        patient_id: s.patient_id,
        patient_name: s.patients?.patient_name || 'Unknown',
        patient_image: s.patients?.profile_image || null,
        session_date: s.start_time,
        status: s.status || 'ongoing',
        duration: duration
      };
    });

    return res.json(formattedSessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// POST /api/sessions - Create new session
router.post('/', async (req, res) => {
  try {
    const { user_id, patient_id, scenario_id } = req.body;

    const { data: session, error } = await supabase
      .from('sessions')
      .insert([
        {
          user_id,
          patient_id,
          scenario_id,
          start_time: new Date().toISOString(),
          status: 'ongoing'
        }
      ])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(session);
  } catch (error) {
    console.error('Error creating session:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// GET /api/sessions/:id - Get single session detail
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: session, error } = await supabase
      .from('sessions')
      .select(`
        *,
        patients (
          patient_name,
          profile_image,
          age,
          gender
        ),
        scenarios (
          scenario_name,
          description
        )
      `)
      .eq('session_id', id)
      .single();

    if (error) throw error;

    return res.json(session);
  } catch (error) {
    console.error('Error fetching session:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// GET /api/sessions/filter - Filter sessions
router.get('/filter', async (req, res) => {
  try {
    const { user_id, session_id } = req.query;

    if (!user_id || !session_id) {
      return res.status(400).json({ message: 'user_id dan session_id diperlukan' });
    }

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select(`
        session_id,
        patient_id,
        status,
        start_time,
        end_time,
        patients (
          patient_name,
          profile_image
        )
      `)
      .eq('user_id', user_id)
      .eq('session_id', session_id);

    if (error) throw error;

    const patients = sessions.map(s => ({
      id: s.patient_id,
      name: s.patients?.patient_name || 'Unknown',
      image: s.patients?.profile_image || null,
      status: s.status,
      lastSession: s.start_time
    }));

    return res.json(patients);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }
});

export default router;
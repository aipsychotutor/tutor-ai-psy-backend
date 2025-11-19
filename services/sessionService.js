import { supabase } from "../supabase.js";

// ========== SERVICE METHODS ==========
export async function checkSession(session_id) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("session_id", session_id)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return {
    exists: !!data,
    session: data,
  };
}

export async function startSession(user_id, patient_id = null) {
  const { data, error } = await supabase
    .from("sessions")
    .insert([
      {
        user_id: user_id,
        patient_id: patient_id,
        status: "active",
      },
    ])
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function endSession(session_id, user_id) {
  const { data, error } = await supabase
    .from("sessions")
    .update({ status: "finished", end_time: new Date().toISOString() })
    .eq("session_id", session_id)
    .eq("user_id", user_id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(
      "Session tidak ditemukan atau Anda tidak punya akses."
    );
  }

  return data;
}
import { supabase } from "../supabase.js";

// ========== SERVICE METHODS ==========
export async function saveTranscripts(session_id, userMessage, messages, prosody_data = null) {
  
  const transcriptsToInsert = [
    { 
      session_id, 
      message_role: "user", 
      message_text: userMessage,
      prosody_data: prosody_data || null
    },
    ...messages.map((m) => ({
      session_id,
      message_role: "assistant",
      message_text: m.text,
    })),
  ];


  const { data, error } = await supabase
    .from("session_transcripts")
    .insert(transcriptsToInsert);

  if (error) {
    console.error("❌ [DATABASE] Insert failed:", error);
    throw error;
  }


  return data;
}

export async function getSessionTranscripts(session_id, user_id) {
  const { data, error } = await supabase
    .from("session_transcripts")
    .select("*, sessions(user_id)")
    .eq("session_id", session_id)
    .eq("sessions.user_id", user_id)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error(
      "Transkrip tidak ditemukan atau Anda tidak punya akses."
    );
  }

  return data;
}
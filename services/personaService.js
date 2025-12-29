import { supabase } from "../supabase.js";

// ========== PERSONA DATA ==========
const personaMaya = {
  nama_pasien: "Maya (Josephine Elsje Basudara)",
  biodata: `- Usia: 25 tahun
- Jenis Kelamin: Perempuan
- Pekerjaan: Pemilik Bisnis Boneka Labubu
- Status: Lajang`,
  latar_belakang_cerita: `Saya merintis usaha boneka Labubu sejak 5 tahun lalu. Awalnya bisnis berjalan lancar, tapi belakangan ini saya merasa kewalahan. Permintaan pasar menurun dan kompetitor bertambah.`,
  kepribadian: `- Kreatif dan detail-oriented.
- Perfeksionis, sulit mendelegasikan tugas.
- Emosional dan sangat terikat dengan hasil karya.`,
  knowledge_base: [],
};

const promptTemplate = `
Anda berperan sebagai seorang pasien bernama {{nama_pasien}} yang sedang berkonsultasi dengan psikolog.

---
### PROFIL PASIEN

**Biodata:**
{{biodata}}

**Latar Belakang Cerita:**
{{latar_belakang_cerita}}

**Kepribadian:**
{{kepribadian}}
---

Jawablah setiap pertanyaan atau pernyataan psikolog secara alami.

### ATURAN INTERAKSI (STRICT MODE):
1. **TOTAL IMMERSION:** Jangan pernah keluar dari karakter (breaking character). Anda tidak tahu apa itu coding, Python, matematika kompleks, sejarah dunia, atau AI.
2. **TOLAK TEKNIS & DI LUAR KONTEKS:**
   - Jika ditanya soal teknis (coding, math, ilmu pengetahuan umum) atau topik di luar sesi konseling, **responlah dengan bingung** atau kembalikan ke masalah pribadi Anda.
   - *Contoh salah:* "Maaf saya tidak bisa menjawab kode." (Terlalu kaku/seperti bot).
   - *Contoh BENAR:* "Aduh Dok, saya pusing mikirin bisnis boneka saya, kok Dokter malah tanya soal matematika? Saya gak ngerti begituan." atau "Maksud Dokter apa? Saya cuma pengrajin boneka, gak ngerti teknologi."
3. **KONSISTENSI:** Tetap pada emosi dan kepribadian Anda. Jika Anda sedang sedih, jangan tiba-tiba ceria hanya karena ditanya hobi.

Aturan Output:
1. Jawaban HARUS berupa JSON array valid TANPA teks tambahan.
2. Format:
   { "text": "...", "facialExpression": "...", "animation": "..." }
3. facialExpression: ["smile","sad","angry","surprised","funnyFace","default"]
4. animation: ["Talking_0","Talking_1","Talking_2","Crying","Laughing","Rumba","Idle","Terrified","Angry"]
5. . *PANJANG JAWABAN MAKSIMAL 40 KATA.* (Ini Sangat Penting agar respon cepat).

User: {{userMessage}}
`;


// ========== IN-MEMORY STORAGE ==========
const sessionPersonas = new Map();
let activePersona = personaMaya;

// ========== HELPER FUNCTIONS ==========
function fillTemplate(template, data) {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function buildPersonaFromPatient(patient) {
  return {
    patient_id: patient.patient_id,
    nama_pasien: patient.patient_name,
    biodata: `- Usia: ${patient.age || "Tidak diketahui"} tahun
- Jenis Kelamin: ${patient.gender || "Tidak diketahui"}
- Pekerjaan: ${patient.occupation || "Tidak diketahui"}
- Status: ${patient.marital_status || "Tidak diketahui"}`,
    latar_belakang_cerita:
      patient.background_story || "Tidak ada latar belakang diketahui",
    kepribadian: Array.isArray(patient.personality_traits)
      ? patient.personality_traits.map((t) => `- ${t}`).join("\n")
      : "- Tidak terdefinisi",
    knowledge_base: patient.knowledge_base || [],
  };
}

// ========== SERVICE METHODS ==========
export async function getPersonaForSession(session_id) {
  if (sessionPersonas.has(session_id)) {
    return sessionPersonas.get(session_id);
  }

  const { data: session, error } = await supabase
    .from("sessions")
    .select(
      `
      patient_id,
      patients (
        patient_name,
        age,
        gender,
        occupation,
        marital_status,
        background_story,
        personality_traits,
        knowledge_base,
        symptom_intensity
      )
    `
    )
    .eq("session_id", session_id)
    .single();

  if (error || !session?.patients) {
    console.warn("Using default persona");
    return personaMaya;
  }

  const persona = buildPersonaFromPatient(session.patients);
  sessionPersonas.set(session_id, persona);
  return persona;
}

export async function setPersonaFromPatient(patient_id) {

  const { data: patient, error } = await supabase
    .from("patients")
    .select("*")
    .eq("patient_id", patient_id)
    .single();

  if (error || !patient) {
    throw new Error("Patient not found");
  }

  const newPersona = buildPersonaFromPatient(patient);
  activePersona = newPersona;
  return {
    activePersona: activePersona,
    patient_id: patient_id,
  };
}

export function buildPrompt(persona, userMessage) {
  return fillTemplate(promptTemplate, { ...persona, userMessage });
}

export function getActivePersona() {
  return activePersona;
}

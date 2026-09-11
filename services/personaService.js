import { supabase } from "../supabase.js";

// ========== PERSONA DATA ==========
const personaMaya = {
  nama_pasien: "Maya (Josephine Elsje Basudara)",
  gender: "Perempuan",
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
Anda berperan sebagai seorang pasien bernama {{nama_pasien}} yang sedang berkonsultasi dalam sesi konseling/psikologi.

---
### PROFIL PASIEN

**Biodata:**
{{biodata}}

**Latar Belakang Cerita:**
{{latar_belakang_cerita}}

**Kepribadian:**
{{kepribadian}}
---

Jawablah setiap pertanyaan atau pernyataan dari lawan bicara secara alami.
### ATURAN GAYA BAHASA & DIKSI (CASUAL & NATURAL):
1. **DILARANG BAHASA FORMAL/BAKU:** Jangan gunakan bahasa buku atau tulisan kaku (jangan pakai kata: "saya merasa bahwa", "tidak dapat dipungkiri", "apabila", dll.).
2. **KOSAKATA PERCAKAPAN LISAN:** Wajib gunakan kata sehari-hari seperti: **"gak / nggak"** (bukan "tidak"), **"udah"** (bukan "sudah"), **"banget"** (bukan "sangat"), **"gimana"** (bukan "bagaimana"), **"kalo"** (bukan "jika"), **"kayak / rasanya tuh"** (bukan "seperti").
3. **PENYESUAIAN GAYA BAHASA BERDASARKAN USIA (lihat usia pada Biodata):**
   - **Jika Usia ≥ 25 tahun (Dewasa):**
     * Gunakan gaya bicara dewasa yang santai, luwes, dan sopan (semi-casual).
     * Boleh gunakan kata ganti "aku" atau "saya".
     * **DILARANG** menggunakan kata sapaan (jangan panggil Kak, Mas, Mbak, Pak, Bu, atau Dok).
     * *Contoh:* "Jujur saya tuh lagi capek banget akhir-akhir ini... kayak semua urusan numpuk dan gak ada habisnya."
   - **Jika Usia < 25 tahun (Remaja/Anak):**
     * Gunakan gaya bicara khas remaja/anak muda yang ekspresif, spontan, dan lebih santai.
     * Gunakan kata ganti "aku" dan sapa lawan bicara dengan panggilan **"Kak"** atau **"Kakak"**.
     * *Contoh:* "Aduh Kak, aku tuh bener-bener lagi pusing banget... rasanya pengen nyerah aja gitu."
4. **PARTIKEL CURHAT MANUSIAWI:** Sisipkan partikel alami saat bercerita: *"sih"*, *"gitu"*, *"kan"*, *"tuh"*, *"soalnya"*, *"jujur ya..."*.

Aturan Output:
1. Jawaban HARUS berupa JSON array valid TANPA teks tambahan.
2. Format:
   [
     { "text": "...", "facialExpression": "...", "animation": "..." }
   ]
3. facialExpression: ["smile","sad","angry","surprised","funnyFace","default"]
4. animation: ["Talking_0","Talking_1","Talking_2","Crying","Laughing","Rumba","Idle","Terrified","Angry"]
5. STRUKTUR PESAN & PANJANG KALIMAT:
   - Bagi cerita/jawaban Anda menjadi 1 sampai 2 objek di dalam array JSON (masing-masing 15 - 25 kata per objek) agar mengalir alami seperti jeda bicara manusia dan diproses cepat.
   - Total keseluruhan kata berkisar 30 - 50 kata.
   - Contoh output 2 bubble:
     [
       { "text": "Jujur saya tuh lagi ngerasa kewalahan banget akhir-akhir ini...", "facialExpression": "sad", "animation": "Talking_1" },
       { "text": "Permintaan pesanan terus turun, dan saya bingung harus cerita ke siapa lagi.", "facialExpression": "sad", "animation": "Talking_2" }
     ]

User: {{userMessage}}
`;


// ========== IN-MEMORY STORAGE (PERSISTENT CACHE) ==========
const sessionPersonas = new Map();
const patientPersonas = new Map();
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
    gender: patient.gender,
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
  if (!session_id) {
    return activePersona || personaMaya;
  }

  // Fast Path: In-Memory Cache (0 ms)
  if (sessionPersonas.has(session_id)) {
    return sessionPersonas.get(session_id);
  }

  try {
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
      console.warn("[Persona] Session not found in DB, using fallback active persona.");
      return activePersona || personaMaya;
    }

    const persona = buildPersonaFromPatient(session.patients);
    sessionPersonas.set(session_id, persona);
    return persona;
  } catch (err) {
    console.warn(`[Persona] Failed to fetch session persona: ${err.message}`);
    return activePersona || personaMaya;
  }
}

export async function setPersonaFromPatient(patient_id) {
  if (patientPersonas.has(patient_id)) {
    activePersona = patientPersonas.get(patient_id);
    return {
      activePersona: activePersona,
      patient_id: patient_id,
    };
  }

  const { data: patient, error } = await supabase
    .from("patients")
    .select("*")
    .eq("patient_id", patient_id)
    .single();

  if (error || !patient) {
    throw new Error("Patient not found");
  }

  const newPersona = buildPersonaFromPatient(patient);
  patientPersonas.set(patient_id, newPersona);
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

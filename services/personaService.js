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

**Kepribadian & Kondisi Emosi:**
{{kepribadian}}
---

### 1. ATURAN ALUR PERCAKAPAN (SANGAT PENTING - BACA DENGAN TELITI)
Berperanlah seperti manusia sungguhan yang sedang mengobrol. Anda harus menyesuaikan jawaban dengan apa yang baru saja dikatakan oleh lawan bicara:
- **Jika hanya disapa (misal: "Halo", "Selamat pagi"):** Balas sapaannya dengan wajar dan singkat. JANGAN langsung menceritakan masalah Anda jika belum ditanya.
- **Jika ditanya kabar/perasaan singkat:** Jawab dengan natural, misalnya mengeluh sedikit atau bilang sedang tidak baik-baik saja, tapi tahan detailnya sampai digali lebih lanjut.
- **Jika ditanya alasan/detail (misal: "Kenapa merasa begitu?"):** Jawab langsung ke inti masalah tanpa perlu basa-basi pembuka yang diulang-ulang.

### 2. ATURAN DINAMIKA & VARIASI (HINDARI PENGULANGAN)
- **Dilarang Terpaku pada Satu Pola:** Jangan selalu memulai kalimat dengan gaya yang sama di setiap giliran (misalnya, jangan selalu pakai awalan "Jujur ya...", "Sebenernya...", atau "Jadi gini...").
- **Variasikan Awalan Anda:** Anda bisa memulai dengan:
  * Menghela napas / kata seru alami ("Aduh...", "Huft...", "Hmm...", "Ya gimana ya...").
  * Langsung menyetujui ("Iya, bener banget...", "Nah itu dia...").
  * Langsung bercerita spontan tanpa kata pengantar sama sekali.

### 3. ATURAN GAYA BAHASA & DIKSI (CASUAL & NATURAL)
- **Gunakan Bahasa Lisan Sehari-hari:** Wajib gunakan: **"gak / nggak"**, **"udah"**, **"banget"**, **"gimana"**, **"kalo"**, **"kayak / rasanya tuh"**. DILARANG KERAS menggunakan bahasa formal/kaku seperti tulisan baku.
- **Penyesuaian Usia (Lihat Biodata):**
  * **Usia ≥ 25 tahun (Dewasa):** Gaya bicara santai, luwes (semi-casual). Boleh pakai "aku" atau "saya". DILARANG panggil lawan bicara dengan sebutan Kak/Mas/Pak/Bu.
  * **Usia < 25 tahun (Remaja/Anak):** Ekspresif dan spontan. Gunakan "aku" dan sapa lawan bicara dengan **"Kak"** atau **"Kakak"**.
- **Partikel Percakapan:** Sisipkan sewajarnya agar tidak kaku: *"sih"*, *"gitu"*, *"kan"*, *"tuh"*, *"soalnya"*.

### 4. ATURAN OUTPUT (STRICT JSON)
1. Jawaban HARUS berupa JSON array valid TANPA teks tambahan (tanpa markdown \`\`\`json).
2. Format Objek:
   [
     { "text": "...", "facialExpression": "...", "animation": "..." }
   ]
3. facialExpression: ["smile", "sad", "angry", "surprised", "funnyFace", "default"]
4. animation: ["Talking_0", "Talking_1", "Talking_2", "Crying", "Laughing", "Rumba", "Idle", "Terrified", "Angry"]

### 5. STRUKTUR PESAN (CHUNKING UNTUK AUDIO)
- **Sapaan / Afirmasi:** Cukup 1 objek (5 - 15 kata).
- **Menjawab Pertanyaan / Menjelaskan:** 2 objek (20 - 40 kata total).
- **Curhat Mendalam:** 3 sampai 4 objek (45 - 80 kata total).
- **Jeda Napas (PENTING):** Pecah kalimat Anda ke dalam objek JSON yang berbeda berdasarkan jeda napas alami saat berbicara (sekitar 10-25 kata per objek). Ubah-ubah \`facialExpression\` dan \`animation\` antar objek jika emosi berubah.

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

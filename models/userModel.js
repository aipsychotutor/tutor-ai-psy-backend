import { supabase } from "../supabase.js";

// Mencari user berdasarkan email
async function findUserByEmail(email) {
    const { data, error } = await supabase
        .from("users")
        .select("user_id, username, email, password, is_admin")
        .eq("email", email)
        .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = tidak ditemukan
        // Log error lain selain 'not found'
        throw new Error("Gagal mengakses database.");
    }

    return data;
}

// Mendaftarkan user baru ke database
async function registerNewUser(username, email, hashedPassword) {
    const { data, error } = await supabase
        .from("users")
        .insert([
            {
                username: username,
                email: email,
                password: hashedPassword,
                is_admin: false, // Default bukan admin
            },
        ])
        .select("user_id, username, email, is_admin");

    if (error) {
        if (error.code === '23505') { // Code untuk unique constraint violation
            throw new Error("Email atau username sudah terdaftar.");
        }
        throw new Error("Gagal menyimpan data user baru.");
    }
    
    // Supabase returns an array for select() after insert
    return data[0]; 
}

async function updateUserPassword(userId, hashedNewPassword) {
    const { data, error } = await supabase
        .from("users")
        .update({ 
            password: hashedNewPassword,
        })
        .eq("user_id", userId)
        .select("user_id, email") // Jangan select password balik ke client
        .single();

    if (error) {
        throw new Error("Gagal memperbarui password user.");
    }

    return data;
}

// Menghapus User beserta seluruh data terkait (Sesi, Transkrip, Evaluasi, Pasien)
async function deleteUser(userId) {
    // Ambil session_id milik user
    const { data: sessions, error: sessionFetchError } = await supabase
        .from("sessions")
        .select("session_id")
        .eq("user_id", userId);

    if (sessionFetchError) throw new Error("Gagal mengambil data sesi user.");
    
    const sessionIds = sessions.map(s => s.session_id);

    // Hapus data di Evaluations & Transcripts
    if (sessionIds.length > 0) {
        await supabase.from("session_evaluations").delete().in("session_id", sessionIds);
        await supabase.from("session_transcripts").delete().in("session_id", sessionIds);
    }

    // Hapus Sesi
    await supabase.from("sessions").delete().eq("user_id", userId);

    // Hapus Pasien yang dibuat oleh user 
    await supabase.from("patients").delete().eq("user_id", userId);

    // Hapus User
    const { error: delUserErr } = await supabase
        .from("users")
        .delete()
        .eq("user_id", userId);

    if (delUserErr) {
        throw new Error("Gagal menghapus akun user.");
    }

    return { success: true };
}

const userModel = { 
    findUserByEmail, 
    registerNewUser, 
    updateUserPassword, 
    deleteUser 
};

export default userModel;
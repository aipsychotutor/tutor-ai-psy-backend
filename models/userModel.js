import { supabase } from "../supabase.js";

// Mencari user berdasarkan email
async function findUserByEmail(email) {
    console.log("DB: Mencari user dengan email:", email);
    const { data, error } = await supabase
        .from("users")
        .select("user_id, username, email, password, is_admin")
        .eq("email", email)
        .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = tidak ditemukan
        // Log error lain selain 'not found'
        console.error("DB Error findUserByEmail:", error);
        throw new Error("Gagal mengakses database.");
    }

    return data;
}

// Mendaftarkan user baru ke database
async function registerNewUser(username, email, hashedPassword) {
    console.log("DB: Mendaftarkan user baru:", email);
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
        console.error("DB Error registerNewUser:", error.message);
        if (error.code === '23505') { // Code untuk unique constraint violation
            throw new Error("Email atau username sudah terdaftar.");
        }
        throw new Error("Gagal menyimpan data user baru.");
    }
    
    // Supabase returns an array for select() after insert
    return data[0]; 
}

const userModel = { findUserByEmail, registerNewUser };
export default userModel;
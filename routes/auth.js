import express from "express";
import { supabase } from "../supabase.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();

// Helper buat bikin token JWT
function generateToken(user) {
    // Tentukan peran (role) berdasarkan flag is_admin
    const role = user.is_admin ? 'admin' : 'user';
    
    return jwt.sign(
        // Payload JWT sekarang menyertakan properti 'role'
        { user_id: user.user_id, email: user.email, role: role },
        process.env.JWT_SECRET,
        { expiresIn: "3h" } // token berlaku 3 jam
    );
}

// ============================
// REGISTER (Default role: 'user')
// ============================
router.post("/register", async (req, res) => {
    const { username, email, password } = req.body;

    try {
        if (!email || !password || !username)
            throw new Error("Username, email, dan password harus diisi");
        if (password.length < 6) throw new Error("Password minimal 6 karakter");

        const hashed = await bcrypt.hash(password, 10);

        // Pengguna baru selalu didaftarkan sebagai is_admin: false (role 'user')
        const { data, error } = await supabase
            .from("users")
            .insert([{ 
                username, 
                email, 
                password_hash: hashed, 
                is_admin: false // Default bukan admin
            }])
            // Ambil kolom is_admin, bukan is_guest
            .select("user_id, username, email, is_admin"); 

        if (error) throw error;

        const user = data[0];
        const token = generateToken(user);
        
        // Kirim kembali data user dengan role yang sudah ditentukan
        res.json({ status: "ok", user: { ...user, role: 'user' }, token });
    } catch (err) {
        res.status(400).json({ status: "error", message: err.message });
    }
});

// ============================
// LOGIN
// ============================
router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) throw new Error("Email dan password harus diisi");

        const { data, error } = await supabase
            .from("users")
            // Ambil flag is_admin
            .select("user_id, username, email, password_hash, is_admin") 
            .eq("email", email)
            .single();

        if (error || !data) throw new Error("User tidak ditemukan");

        const valid = await bcrypt.compare(password, data.password_hash);
        if (!valid) throw new Error("Password salah");

        // Hapus password_hash sebelum generate token dan mengirim ke client
        const { password_hash, ...safeUser } = data;
        const token = generateToken(safeUser);
        
        // Tentukan peran untuk dikirim ke client
        const role = safeUser.is_admin ? 'admin' : 'user';

        // Kirim kembali data user dengan role
        res.json({ status: "ok", user: { ...safeUser, role: role }, token });
    } catch (err) {
        res.status(400).json({ status: "error", message: err.message });
    }
});

export default router;
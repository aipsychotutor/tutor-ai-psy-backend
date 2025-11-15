import express from "express";
import { supabase } from "../supabase.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();

console.log("AUTH ROUTE: JWT Secret loaded:", !!process.env.JWT_SECRET);
if (!process.env.JWT_SECRET) {
  console.error("KRITIS: JWT_SECRET belum dimuat!");
}

// Helper buat bikin token JWT
function generateToken(user) {
  // Tentukan peran (role) berdasarkan flag is_admin
  const role = user.is_admin ? "admin" : "user";

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
  const passwordRegex = /^(?=.[a-z])(?=.[A-Z])(?=.*[0-9])(?=.{8,})/;

  try {
    if (!email || !password || !username)
      throw new Error("Username, email, dan password harus diisi");

    const hashed = await bcrypt.hash(password, 10);

    // Pengguna baru selalu didaftarkan sebagai is_admin: false (role 'user')
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          username,
          email,
          password: hashed,
          is_admin: false, // Default bukan admin
        },
      ])
      // Ambil kolom is_admin, bukan is_guest
      .select("user_id, username, email, is_admin");

    if (error) throw error;

    const user = data[0];
    const token = generateToken(user);

    // Kirim kembali data user dengan role yang sudah ditentukan
    res.json({ status: "ok", user: { ...user, role: "user" }, token });
  } catch (err) {
    console.error("SERVER ERROR LOG:", err.message);
    res.status(400).json({ status: "error", message: err.message });
  }
});

// ============================
// LOGIN
// ============================
router.post("/login", async (req, res) => {
  const { email, password: inputPassword } = req.body;

  try {
    if (!email || !inputPassword)
      throw new Error("Email dan password harus diisi");
    console.log("SERVER: Mulai query Supabase untuk login:", email);

    const { data, error } = await supabase
      .from("users")
      // Ambil flag is_admin
      .select("user_id, username, email, password, is_admin")
      .eq("email", email)
      .single();

    console.log("SERVER: Query selesai. Data ditemukan:", !!data);
    if (error || !data) throw new Error("User tidak ditemukan");

    console.log("SERVER: Mulai membandingkan password.");
    const valid = await bcrypt.compare(inputPassword, data.password);
    console.log("SERVER: Perbandingan password selesai.");
    if (!valid) throw new Error("Password salah");

    // Hapus password sebelum generate token dan mengirim ke client
    const { password: dbPassword, ...safeUser } = data;
    console.log("SERVER: Mulai membuat token.");
    const token = generateToken(safeUser);
    console.log("SERVER: Token berhasil dibuat.");
    console.log();
    // Tentukan peran untuk dikirim ke client
    const role = safeUser.is_admin ? "admin" : "user";

    // Kirim kembali data user dengan role
    res.json({ status: "ok", user: { ...safeUser, role: role }, token });
  } catch (err) {
    console.error("SERVER ERROR LOG:", err.message);
    res.status(400).json({ status: "error", message: err.message });
  }
});

export default router;

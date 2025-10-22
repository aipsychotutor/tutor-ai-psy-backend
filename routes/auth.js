// ./routes/auth.js

import express from "express";
import { supabase } from "../supabase.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();

// Helper buat bikin token JWT
function generateToken(user) {
  return jwt.sign(
    { user_id: user.user_id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "1h" } // token berlaku 1 jam
  );
}

// ============================
// REGISTER
// ============================
router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    if (!email || !password || !username)
      throw new Error("Username, email, dan password harus diisi");
    if (password.length < 6) throw new Error("Password minimal 6 karakter");

    const hashed = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("users")
      .insert([{ username, email, password_hash: hashed, is_guest: false }])
      .select("user_id, username, email, is_guest");

    if (error) throw error;

    const user = data[0];
    const token = generateToken(user);

    res.json({ status: "ok", user, token });
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
      .select("user_id, username, email, password_hash, is_guest")
      .eq("email", email)
      .single();

    if (error || !data) throw new Error("User tidak ditemukan");

    const valid = await bcrypt.compare(password, data.password_hash);
    if (!valid) throw new Error("Password salah");

    const { password_hash, ...safeUser } = data;
    const token = generateToken(safeUser);

    res.json({ status: "ok", user: safeUser, token });
  } catch (err) {
    res.status(400).json({ status: "error", message: err.message });
  }
});

// ============================
// BUAT GUEST USER
// ============================
router.post("/guest", async (req, res) => {
  try {
    const { nama } = req.body;
    if (!nama || nama.trim() === "") throw new Error("Nama harus diisi");

    const cleanName = nama.trim();

    // Cek apakah guest dengan nama ini sudah ada
    const { data: existingUser, error: findError } = await supabase
      .from("users")
      .select("user_id, username, is_guest, created_at")
      .eq("username", cleanName)
      .eq("is_guest", true)
      .single();
    if (findError && findError.code !== "PGRST116") throw findError;

    // Kalau sudah ada, langsung balikin user dan token
    if (existingUser) {
      const token = generateToken(existingUser);
      return res.json({
        status: "ok",
        user: existingUser,
        token,
        message: "Guest lama digunakan kembali",
      });
    }

    // Kalau belum ada, buat guest baru
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert([{ username: cleanName, is_guest: true }])
      .select("user_id, username, is_guest, created_at")
      .single();

    if (insertError) throw insertError;

    const token = generateToken(newUser);

    res.json({
      status: "ok",
      user: newUser,
      token,
      message: "Guest baru dibuat",
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});

// ============================
// UPGRADE GUEST JADI USER
// ============================
router.post("/upgrade", async (req, res) => {
  const { user_id, username, email, password } = req.body;

  try {
    if (!user_id || !username || !email || !password)
      throw new Error("Semua field harus diisi");
    if (password.length < 6) throw new Error("Password minimal 6 karakter");

    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("is_guest")
      .eq("user_id", user_id)
      .single();

    if (fetchError || !existingUser) throw new Error("User tidak ditemukan");
    if (!existingUser.is_guest) throw new Error("User sudah terdaftar");

    const hashed = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("users")
      .update({
        username,
        email,
        password_hash: hashed,
        is_guest: false,
      })
      .eq("user_id", user_id)
      .select("user_id, username, email, is_guest");

    if (error) throw error;

    const user = data[0];
    const token = generateToken(user);

    res.json({ status: "ok", user, token });
  } catch (err) {
    res.status(400).json({ status: "error", message: err.message });
  }
});

export default router;

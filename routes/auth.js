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

// Register
router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    // Validasi input
    if (!email || !password || !username) throw new Error("Username, email and password are required");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");

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

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) throw new Error("Email and password are required");

    const { data, error } = await supabase
      .from("users")
      .select("user_id, username, email, password_hash, is_guest")
      .eq("email", email)
      .single();

    if (error || !data) throw new Error("User not found");

    const valid = await bcrypt.compare(password, data.password_hash);
    if (!valid) throw new Error("Invalid password");

    // Hilangkan password_hash dari response
    const { password_hash, ...safeUser } = data;
    const token = generateToken(safeUser);

    res.json({ status: "ok", user: safeUser, token });
  } catch (err) {
    res.status(400).json({ status: "error", message: err.message });
  }
});

// Buat guest baru
router.post("/guest", async (req, res) => {
  try {
    const { nama } = req.body;

    if (!nama || nama.trim() === "") {
      return res.status(400).json({ status: "error", message: "Nama harus diisi" });
    }

    // Buat user guest baru di tabel 'users'
    const { data, error } = await supabase
      .from("users")
      .insert([{ username: nama.trim(), is_guest: true }])
      .select("user_id, username, is_guest, created_at")
      .single();

    if (error) throw error;

    // Buat session baru di tabel 'sessions'
    const { data: sessionData, error: sessionError } = await supabase
      .from("sessions")
      .insert([
        { user_id: data.user_id, created_at: new Date().toISOString() }
      ])
      .select("session_id, user_id, created_at")
      .single();

    if (sessionError) throw sessionError;

    res.json({
      status: "ok",
      user: data,
      session: sessionData
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Upgrade guest jadi login user
router.post("/upgrade", async (req, res) => {
  const { user_id, username, email, password } = req.body;

  try {
    if (!user_id || !username || !email || !password) throw new Error("All fields are required");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");

    // Cek dulu apakah user masih guest
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("is_guest")
      .eq("user_id", user_id)
      .single();

    if (fetchError || !existingUser) throw new Error("User not found");
    if (!existingUser.is_guest) throw new Error("User is already registered");

    // Hash password baru
    const hashed = await bcrypt.hash(password, 10);

    // Update guest user jadi login user
    const { data, error } = await supabase
      .from("users")
      .update({
        username,
        email,
        password_hash: hashed,
        is_guest: false
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

import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import UserModel from "../models/userModel.js"; 
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Memastikan JWT_SECRET sudah dimuat
if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET belum dimuat!");
}

// Helper untuk membuat token JWT
function generateToken(user) {
    const role = user.is_admin ? "admin" : "user";

    return jwt.sign(
        { user_id: user.user_id, email: user.email, role: role },
        process.env.JWT_SECRET,
        { expiresIn: "3h" } // token berlaku 3 jam
    );
}

router.post("/register", async (req, res) => {
    const { username, email, password } = req.body;

    try {
        if (!email || !password || !username)
            throw new Error("Username, email, dan password harus diisi");
        const passwordRegex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/;

        if (!passwordRegex.test(password)) {
            throw new Error(
                "Password minimal 8 karakter, mengandung huruf besar, huruf kecil, dan angka"
            );
        }
        
        const existingUser = await UserModel.findUserByEmail(email); 
        if (existingUser) {
            throw new Error("Email sudah terdaftar. Silakan login.");
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await UserModel.registerNewUser(username, email, hashedPassword); 
        const token = generateToken(user);

        res.json({ status: "ok", user: { ...user, role: "user" }, token });
    } catch (err) {
        res.status(400).json({ status: "error", message: err.message });
    }
});

router.post("/login", async (req, res) => {
    const { email, password: inputPassword } = req.body;

    try {
        if (!email || !inputPassword)
            throw new Error("Email dan password harus diisi");

        const data = await UserModel.findUserByEmail(email);

        if (!data) throw new Error("Email atau password salah.");

        const valid = await bcrypt.compare(inputPassword, data.password);
        
        if (!valid) throw new Error("Email atau password salah.");

        const { password: dbPassword, ...safeUser } = data;
        const token = generateToken(safeUser);
        
        // Tentukan peran untuk dikirim ke client
        const role = safeUser.is_admin ? "admin" : "user";

        res.json({ status: "ok", user: { ...safeUser, role: role }, token });
    } catch (err) {
        res.status(400).json({ status: "error", message: err.message });
    }
});

router.put("/update-password", authMiddleware(["user", "admin"]), async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user.user_id; 
  const email = req.user.email;

  try {
    if (!oldPassword || !newPassword) {
      throw new Error("Password lama dan baru harus diisi");
    }

    // Cari data user di DB (untuk ambil hash password lama)
    const user = await UserModel.findUserByEmail(email);
    if (!user) throw new Error("User tidak ditemukan");

    // Verifikasi password lama
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) throw new Error("Password lama salah");

    // Validasi format password baru (opsional tapi disarankan)
    const passwordRegex = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      throw new Error("Password baru minimal 8 karakter, ada huruf besar, kecil, dan angka");
    }

    // Hash password baru & Simpan
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await UserModel.updateUserPassword(userId, hashedNewPassword);

    res.json({ status: "ok", message: "Password berhasil diperbarui" });
  } catch (err) {
    res.status(400).json({ status: "error", message: err.message });
  }
});

router.delete("/delete-account", authMiddleware(["user", "admin"]), async (req, res) => {
  const userId = req.user.user_id;

  try {
    await UserModel.deleteUser(userId);

    res.json({ 
      status: "ok", 
      message: "Akun dan seluruh data riwayat Anda telah dihapus secara permanen." 
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

export default router;
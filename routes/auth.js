import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import UserModel from "../models/userModel.js"; 

const router = express.Router();

console.log("AUTH ROUTE: JWT Secret loaded:", !!process.env.JWT_SECRET);
if (!process.env.JWT_SECRET) {
    console.error("KRITIS: JWT_SECRET belum dimuat!");
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

        const existingUser = await UserModel.findUserByEmail(email); 
        if (existingUser) {
            throw new Error("Email sudah terdaftar. Silakan login.");
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await UserModel.registerNewUser(username, email, hashedPassword); 

        console.log("SERVER: User berhasil didaftarkan:", user.email);
        const token = generateToken(user);

        res.json({ status: "ok", user: { ...user, role: "user" }, token });
    } catch (err) {
        console.error("SERVER ERROR LOG:", err.message);
        res.status(400).json({ status: "error", message: err.message });
    }
});

router.post("/login", async (req, res) => {
    const { email, password: inputPassword } = req.body;

    try {
        if (!email || !inputPassword)
            throw new Error("Email dan password harus diisi");
        console.log("SERVER: Mulai proses login untuk:", email);

        const data = await UserModel.findUserByEmail(email);

        if (!data) throw new Error("Email atau password salah.");

        console.log("SERVER: User ditemukan. Mulai membandingkan password.");
        const valid = await bcrypt.compare(inputPassword, data.password);
        
        if (!valid) throw new Error("Email atau password salah.");

        const { password: dbPassword, ...safeUser } = data;
        
        console.log("SERVER: Token berhasil dibuat.");
        const token = generateToken(safeUser);
        
        // Tentukan peran untuk dikirim ke client
        const role = safeUser.is_admin ? "admin" : "user";

        res.json({ status: "ok", user: { ...safeUser, role: role }, token });
    } catch (err) {
        console.error("SERVER ERROR LOG:", err.message);
        res.status(400).json({ status: "error", message: err.message });
    }
});

export default router;
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import UserModel from "../models/userModel.js"; 

const router = express.Router();

console.log("AUTH ROUTE: JWT Secret loaded:", !!process.env.JWT_SECRET);
if (!process.env.JWT_SECRET) {
    console.error("KRITIS: JWT_SECRET belum dimuat!");
}

/**
 * @swagger
 * tags:
 *   - name: Authentication
 *     description: Endpoint untuk registrasi dan login pengguna
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - username
 *         - email
 *         - password
 *       properties:
 *         username:
 *           type: string
 *           description: Nama pengguna
 *           example: johndoe
 *         email:
 *           type: string
 *           format: email
 *           description: Email pengguna
 *           example: john@example.com
 *         password:
 *           type: string
 *           format: password
 *           description: Password pengguna (minimal 8 karakter dengan kombinasi huruf dan angka)
 *           example: Password123
 *     LoginRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: Email pengguna
 *           example: john@example.com
 *         password:
 *           type: string
 *           format: password
 *           description: Password pengguna
 *           example: password123
 *     AuthResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           example: ok
 *         user:
 *           type: object
 *           properties:
 *             user_id:
 *               type: string
 *               format: uuid
 *             username:
 *               type: string
 *             email:
 *               type: string
 *             role:
 *               type: string
 *               enum: [user, admin]
 *             is_admin:
 *               type: boolean
 *             created_at:
 *               type: string
 *               format: date-time
 *         token:
 *           type: string
 *           description: JWT token untuk autentikasi (berlaku 3 jam)
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           example: error
 *         message:
 *           type: string
 *           example: Email sudah terdaftar. Silakan login.
 */

// Helper untuk membuat token JWT
function generateToken(user) {
    const role = user.is_admin ? "admin" : "user";

    return jwt.sign(
        { user_id: user.user_id, email: user.email, role: role },
        process.env.JWT_SECRET,
        { expiresIn: "3h" } // token berlaku 3 jam
    );
}

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Registrasi pengguna baru
 *     description: Mendaftarkan pengguna baru dengan username, email, dan password. Password akan di-hash sebelum disimpan.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       200:
 *         description: Registrasi berhasil, mengembalikan data user dan JWT token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Registrasi gagal (email sudah terdaftar atau data tidak lengkap)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
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

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login pengguna
 *     description: Autentikasi pengguna dengan email dan password. Mengembalikan JWT token jika berhasil.
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login berhasil, mengembalikan data user dan JWT token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Login gagal (email atau password salah)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
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
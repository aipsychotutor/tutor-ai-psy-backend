import jwt from "jsonwebtoken";
import "dotenv/config";

/**
 * Middleware Gabungan untuk Autentikasi (Token) dan Otorisasi (Role).
 *
 * @param {string[]} requiredRoles - Array berisi peran (role) yang diizinkan (misalnya, ['user', 'admin']).
 * @returns {function} Fungsi middleware Express (req, res, next).
 */

const authMiddleware = (requiredRoles) => (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  // --- Langkah 1: Autentikasi (Verifikasi Token) ---
  if (token == null) {
    return res.status(401).json({ message: "Akses ditolak: Token tidak ada." });
  }

  try {
    const decodedPayload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decodedPayload; // Isi req.user dari payload token

    // --- Langkah 2: Otorisasi (Periksa Role) ---
    const user = req.user;

    if (!user || !user.role) {
      return res.status(403).json({
        message: "Akses Ditolak. Informasi peran tidak tersedia di token.",
      });
    }

    const userRole = user.role;

    // Pengecekan Otorisasi
    if (requiredRoles.includes(userRole)) {
      return next(); // Lanjut ke handler route jika role diizinkan
    } else {
      // 403 Forbidden: Peran tidak diizinkan
      return res.status(403).json({
        message: "Akses Ditolak. Anda tidak memiliki izin yang diperlukan.",
      });
    }
  } catch (err) {
    // Menangani error JWT seperti token kedaluwarsa atau tidak valid
    if (err.name === "JsonWebTokenError") {
      return res
        .status(401)
        .json({ message: "Akses ditolak: Token tidak valid." });
    }

    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ message: "Akses ditolak: Token sudah kadaluarsa." });
    }
    return res
      .status(500)
      .json({ message: "Internal server error di middleware." });
  }
};

export default authMiddleware;
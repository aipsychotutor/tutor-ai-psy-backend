import jwt from "jsonwebtoken";
import 'dotenv/config';

/**
 * Middleware Gabungan untuk Autentikasi (Token) dan Otorisasi (Role).
 *
 * @param {string[]} requiredRoles - Array berisi peran (role) yang diizinkan (misalnya, ['user', 'admin']).
 * @returns {function} Fungsi middleware Express (req, res, next).
 */
const authMiddleware = (requiredRoles) => (req, res, next) => {
    console.log('========================================');
    console.log('[AUTH] 🔐 REQUEST AUTHENTICATION START');
    console.log('[AUTH] Method:', req.method);
    console.log('[AUTH] Path:', req.path);
    console.log('[AUTH] Full URL:', req.originalUrl);
    console.log('[AUTH] Required Roles:', requiredRoles);
    
    const authHeader = req.headers['authorization'];
    console.log('[AUTH] Authorization Header:', authHeader ? '✅ EXISTS' : '❌ MISSING');
    
    const token = authHeader && authHeader.split(' ')[1];

    // --- Langkah 1: Autentikasi (Verifikasi Token) ---
    if (token == null) {
        console.log('[AUTH] ❌ Token is NULL or UNDEFINED');
        console.log('========================================\n');
        return res.status(401).json({ message: 'Akses ditolak: Token tidak ada.' });
    }

    console.log('[AUTH] Token (first 20 chars):', token.substring(0, 20) + '...');

    try {
        console.log("[AUTH] 🔍 Memverifikasi token...");
        console.log("[AUTH] JWT_SECRET exists:", !!process.env.JWT_SECRET);
        
        const decodedPayload = jwt.verify(token, process.env.JWT_SECRET);
        
        console.log(`[AUTH] ✅ Token berhasil diverifikasi!`);
        console.log(`[AUTH] User Email: ${decodedPayload.email}`);
        console.log(`[AUTH] User ID: ${decodedPayload.user_id}`);
        console.log(`[AUTH] User Role: ${decodedPayload.role}`);
        
        req.user = decodedPayload; // Isi req.user dari payload token

        // --- Langkah 2: Otorisasi (Periksa Role) ---
        const user = req.user;
        
        if (!user || !user.role) {
            console.log('[AUTH] ❌ User atau Role tidak tersedia di token payload');
            console.log('========================================\n');
            return res.status(403).json({ 
                message: 'Akses Ditolak. Informasi peran tidak tersedia di token.' 
            });
        }

        const userRole = user.role; 
        
        console.log(`[AUTH] 🔑 Checking authorization...`);
        console.log(`[AUTH] User Role: '${userRole}'`);
        console.log(`[AUTH] Required Roles: [${requiredRoles.join(', ')}]`);
        
        // Pengecekan Otorisasi
        if (requiredRoles.includes(userRole)) {
            console.log(`[AUTH] ✅ AUTHORIZED - Role '${userRole}' is allowed`);
            console.log('[AUTH] 🚀 Calling next() - Proceeding to route handler...');
            console.log('========================================\n');
            return next(); // Lanjut ke handler route jika role diizinkan
        } else {
            // 403 Forbidden: Peran tidak diizinkan
            console.log(`[AUTH] ❌ FORBIDDEN - Role '${userRole}' is NOT allowed`);
            console.log(`[AUTH] Required one of: ${requiredRoles.join(', ')}`);
            console.log('========================================\n');
            return res.status(403).json({ 
                message: 'Akses Ditolak. Anda tidak memiliki izin yang diperlukan.' 
            });
        }

    } catch (err) { 
        console.log('[AUTH] ❌❌❌ ERROR OCCURRED ❌❌❌');
        console.error("[AUTH] Error Name:", err.name);
        console.error("[AUTH] Error Message:", err.message);
        console.error("[AUTH] Error Stack:", err.stack);
        
        // Menangani error JWT seperti token kedaluwarsa atau tidak valid
        if (err.name === 'JsonWebTokenError') {
            console.log('[AUTH] Token is INVALID (malformed or signature verification failed)');
            console.log('========================================\n');
            return res.status(401).json({ message: 'Akses ditolak: Token tidak valid.' });
        }
        
        if (err.name === 'TokenExpiredError') {
            console.log('[AUTH] Token is EXPIRED');
            console.log(`[AUTH] Token expired at: ${err.expiredAt}`);
            console.log('========================================\n');
            return res.status(401).json({ message: 'Akses ditolak: Token sudah kadaluarsa.' });
        }
        
        console.log('[AUTH] Unknown error type');
        console.log('========================================\n');
        return res.status(500).json({ message: 'Internal server error di middleware.' });
    }
};

export default authMiddleware;
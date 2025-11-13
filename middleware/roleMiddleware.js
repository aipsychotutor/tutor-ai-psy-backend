/**
 * Middleware Otorisasi: Memeriksa apakah peran (role) pengguna diizinkan.
 * * Middleware ini HARUS dipanggil SETELAH authMiddleware, 
 * karena ia bergantung pada properti req.user yang sudah diisi oleh payload token.
 *
 * @param {string[]} requiredRoles - Array berisi peran (role) yang diizinkan (misalnya, ['user', 'admin']).
 * @returns {function} Fungsi middleware Express (req, res, next).
 */
const checkRole = (requiredRoles) => (req, res, next) => {
    // req.user diisi oleh authMiddleware
    const user = req.user; 

    // Pastikan user terautentikasi dan memiliki role
    if (!user || !user.role) {
        // Ini jarang terjadi jika authMiddleware sudah sukses, tapi bagus untuk berjaga-jaga.
        return res.status(403).json({ 
            message: 'Akses Ditolak. Informasi peran tidak tersedia. Pastikan token berisi role.' 
        });
    }

    const userRole = user.role; 

    // Pengecekan Otorisasi: Apakah peran pengguna ada di daftar peran yang diwajibkan
    if (requiredRoles.includes(userRole)) {
        return next();
    } else {
        // 403 Forbidden: Peran tidak diizinkan
        console.warn(`Akses ditolak: Peran '${userRole}' tidak diizinkan. Dibutuhkan: ${requiredRoles.join(', ')}`);
        return res.status(403).json({ 
            message: 'Akses Ditolak. Anda tidak memiliki izin yang diperlukan.' 
        });
    }
};

export default checkRole;
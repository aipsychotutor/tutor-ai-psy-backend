import jwt from "jsonwebtoken";
import 'dotenv/config';

const authMiddleware = (req, res, next) => {
  try { 
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
      return res.status(401).json({ message: 'Akses ditolak: Token tidak ada.' });
    }

    const decodedPayload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decodedPayload; 
    next(); 

  } catch (err) { // menangkap error .split() DAN error jwt.verify()
    console.error("❌ Error di Middleware Auth:", err.message);
    
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(403).json({ message: 'Akses ditolak: Token tidak valid.' });
    }
    
    // menangkap error lainnya (spt .split())
    return res.status(500).json({ message: 'Internal server error di middleware.' });
  }
};

export default authMiddleware;
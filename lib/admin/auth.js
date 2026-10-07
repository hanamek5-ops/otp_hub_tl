import crypto from 'crypto';
import { redis } from '../redis.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const adminKey = process.env.ADMIN_SECRET_KEY;
    if (!adminKey || !adminKey.trim()) {
        return res.status(500).json({ error: 'ADMIN_SECRET_KEY chưa được cấu hình trên biến môi trường' });
    }

    // Rate Limiting theo IP chống brute-force
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const rateLimitKey = `otphub:admin_failed_attempts:${clientIp}`;

    try {
        const attempts = Number(await redis.get(rateLimitKey)) || 0;
        if (attempts >= 5) {
            return res.status(429).json({ error: 'Bạn đã nhập sai quá 5 lần. Vui lòng đợi 5 phút trước khi thử lại.' });
        }
    } catch (_) {}

    const { password } = req.body || {};
    const inputPass = String(password || '');

    // Kiểm tra an toàn chống timing attack
    let isMatch = false;
    try {
        const bufA = Buffer.from(inputPass);
        const bufB = Buffer.from(adminKey);
        if (bufA.length === bufB.length) {
            isMatch = crypto.timingSafeEqual(bufA, bufB);
        }
    } catch (_) {}

    if (isMatch) {
        // Đăng nhập thành công: xóa lịch sử thử sai
        try { await redis.del(rateLimitKey); } catch (_) {}
        return res.status(200).json({ token: Buffer.from(adminKey).toString('base64') });
    } else {
        // Ghi nhận lần thử sai (hết hạn sau 5 phút)
        try {
            await redis.incr(rateLimitKey);
            await redis.expire(rateLimitKey, 300);
        } catch (_) {}
        return res.status(401).json({ error: 'Mật khẩu sai' });
    }
}

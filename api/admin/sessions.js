import { redis, KEYS } from '../../lib/redis.js';

function parseSession(s) {
    if (typeof s === 'string') {
        try { return JSON.parse(s); } catch { return { raw: s }; }
    }
    return s || {};
}

function normalizeSession(s) {
    const item = parseSession(s);
    const startTs = item.start_time || (item.created_at ? new Date(item.created_at).getTime() : Date.now());
    const otpVal = item.otp || item.otp_code || null;
    return {
        ...item,
        otp: otpVal,
        otp_code: otpVal,
        start_time: startTs,
        created_at: item.created_at || new Date(startTs).toISOString(),
        received_at: item.received_at || null
    };
}

export default async function handler(req, res) {
    const auth = req.headers.authorization;
    if (!auth || Buffer.from(auth.replace('Bearer ', ''), 'base64').toString() !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        if (req.method === 'GET') {
            const rawSessions = (await redis.lrange(KEYS.SESSIONS, 0, 500)) || [];
            const sessions = rawSessions.map(normalizeSession);

            return res.status(200).json({
                total: sessions.length,
                sessions
            });
        }

        if (req.method === 'POST') {
            const { action, payload } = req.body || {};

            if (action === 'delete') {
                const { sessionId } = payload || {};
                if (!sessionId) return res.status(400).json({ error: 'Thiếu sessionId' });

                const rawSessions = (await redis.lrange(KEYS.SESSIONS, 0, 1000)) || [];
                const sessions = rawSessions.map(parseSession).filter(s => s.id !== sessionId);

                await redis.del(KEYS.SESSIONS);
                if (sessions.length) {
                    await redis.rpush(KEYS.SESSIONS, ...sessions);
                }
                return res.status(200).json({ success: true, message: 'Đã xóa phiên thuê thành công!' });
            }

            if (action === 'clear_all') {
                await redis.del(KEYS.SESSIONS);
                return res.status(200).json({ success: true, message: 'Đã xóa toàn bộ lịch sử phiên thuê thành công!' });
            }

            if (action === 'update') {
                const { id, otp, status, price } = payload || {};
                if (!id) return res.status(400).json({ error: 'Thiếu session ID' });

                const rawSessions = (await redis.lrange(KEYS.SESSIONS, 0, 1000)) || [];
                const sessions = rawSessions.map(parseSession);
                const targetIndex = sessions.findIndex(s => s.id === id);

                if (targetIndex === -1) {
                    return res.status(404).json({ error: 'Không tìm thấy phiên thuê' });
                }

                const s = sessions[targetIndex];
                if (otp !== undefined) {
                    const cleanOtp = String(otp).trim() || null;
                    s.otp = cleanOtp;
                    s.otp_code = cleanOtp;
                }
                if (status !== undefined) {
                    s.status = status;
                    if (status === 'success' && !s.received_at) {
                        s.received_at = Date.now();
                    }
                }
                if (price !== undefined && !isNaN(Number(price))) {
                    s.price = Number(price);
                }

                sessions[targetIndex] = s;

                await redis.del(KEYS.SESSIONS);
                if (sessions.length) {
                    await redis.rpush(KEYS.SESSIONS, ...sessions);
                }

                return res.status(200).json({
                    success: true,
                    message: 'Đã cập nhật phiên thuê thành công!',
                    session: normalizeSession(s)
                });
            }

            return res.status(400).json({ error: 'Action không hợp lệ' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

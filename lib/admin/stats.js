import { redis, KEYS } from '../redis.js';

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
        const users = Object.values((await redis.hgetall(KEYS.USERS)) || {});
        const rawSessions = (await redis.lrange(KEYS.SESSIONS, 0, 1000)) || [];
        const sessions = rawSessions.map(normalizeSession);

        const totalBalance = users.reduce((sum, u) => sum + (u.balance || 0), 0);
        const successSessions = sessions.filter(s => s.status === 'success');
        const revenue = successSessions.reduce((sum, s) => sum + (s.price || 0), 0);

        return res.status(200).json({
            totalUsers: users.length,
            totalBalance,
            totalSessions: sessions.length,
            successSessions: successSessions.length,
            revenue,
            recentSessions: sessions.slice(0, 30)
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

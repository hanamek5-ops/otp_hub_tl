import { redis, KEYS } from '../../lib/redis.js';

export default async function handler(req, res) {
    const auth = req.headers.authorization;
    if (!auth || Buffer.from(auth.replace('Bearer ', ''), 'base64').toString() !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const rawSessions = (await redis.lrange(KEYS.SESSIONS, 0, 500)) || [];
        const sessions = rawSessions.map(s => {
            if (typeof s === 'string') {
                try { return JSON.parse(s); } catch { return { raw: s }; }
            }
            return s;
        });

        return res.status(200).json({
            total: sessions.length,
            sessions
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

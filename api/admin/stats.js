import { redis, KEYS } from '../../lib/redis.js';

export default async function handler(req, res) {
    const auth = req.headers.authorization;
    if (!auth || Buffer.from(auth.replace('Bearer ', ''), 'base64').toString() !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const users = Object.values((await redis.hgetall(KEYS.USERS)) || {});
    const sessions = (await redis.lrange(KEYS.SESSIONS, 0, 1000)) || [];

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
}
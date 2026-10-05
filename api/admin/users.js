import { redis, KEYS } from '../../lib/redis.js';

export default async function handler(req, res) {
    const auth = req.headers.authorization;
    if (!auth || Buffer.from(auth.replace('Bearer ', ''), 'base64').toString() !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'GET') {
        const users = Object.values((await redis.hgetall(KEYS.USERS)) || {});
        return res.status(200).json(users);
    }

    if (req.method === 'POST') {
        const { userId, amount } = req.body;
        const user = await redis.hget(KEYS.USERS, String(userId));
        if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
        user.balance += Number(amount);
        await redis.hset(KEYS.USERS, { [user.id]: user });
        return res.status(200).json(user);
    }
}
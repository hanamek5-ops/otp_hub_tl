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
        try {
            const { userId, amount } = req.body;
            const uid = String(userId).trim();
            if (!uid) return res.status(400).json({ error: 'User ID không hợp lệ' });

            let user = await redis.hget(KEYS.USERS, uid);
            if (!user) {
                // Tự động tạo user nếu chưa có trong DB
                user = {
                    id: uid,
                    name: `User ${uid}`,
                    username: '',
                    balance: 0,
                    created_at: new Date().toISOString()
                };
            }
            user.balance = (Number(user.balance) || 0) + Number(amount);
            await redis.hset(KEYS.USERS, { [user.id]: user });
            return res.status(200).json(user);
        } catch (err) {
            console.error('Update balance error:', err);
            return res.status(500).json({ error: err.message });
        }
    }
}
import { redis, KEYS } from '../redis.js';
import { OTPHubManager } from '../manager.js';
import crypto from 'crypto';

const mgr = new OTPHubManager(null);

export default async function handler(req, res) {
    const auth = req.headers.authorization;
    if (!auth || Buffer.from(auth.replace('Bearer ', ''), 'base64').toString() !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'GET') {
        const usersObj = (await redis.hgetall(KEYS.USERS)) || {};
        const users = Object.values(usersObj);

        // Đảm bảo tất cả user đều có api_key
        const updates = {};
        const keyIndex = {};
        for (const u of users) {
            if (!u.api_key) {
                u.api_key = crypto.randomBytes(16).toString('hex');
                updates[u.id] = u;
                keyIndex[u.api_key] = u.id;
            }
        }
        if (Object.keys(updates).length) {
            await redis.hset(KEYS.USERS, updates);
            await redis.hset(KEYS.API_KEYS, keyIndex);
        }

        return res.status(200).json(users);
    }

    if (req.method === 'POST') {
        try {
            const { action, userId, amount } = req.body;
            const uid = String(userId).trim();
            if (!uid) return res.status(400).json({ error: 'User ID không hợp lệ' });

            if (action === 'reset_api_key') {
                const newKey = await mgr.generateNewApiKey(uid);
                const user = await redis.hget(KEYS.USERS, uid);
                return res.status(200).json({ success: true, api_key: newKey, user });
            }

            let user = await redis.hget(KEYS.USERS, uid);
            if (!user) {
                // Tự động tạo user nếu chưa có trong DB
                const apiKey = crypto.randomBytes(16).toString('hex');
                user = {
                    id: uid,
                    name: `User ${uid}`,
                    username: '',
                    balance: 0,
                    api_key: apiKey,
                    created_at: new Date().toISOString()
                };
                await redis.hset(KEYS.API_KEYS, { [apiKey]: uid });
            } else if (!user.api_key) {
                user.api_key = crypto.randomBytes(16).toString('hex');
                await redis.hset(KEYS.API_KEYS, { [user.api_key]: uid });
            }

            user.balance = (Number(user.balance) || 0) + Number(amount);
            await redis.hset(KEYS.USERS, { [user.id]: user });
            return res.status(200).json(user);
        } catch (err) {
            console.error('User action error:', err);
            return res.status(500).json({ error: err.message });
        }
    }
}

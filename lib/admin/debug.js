import { TelegramBot } from '../telegram.js';
import { redis, KEYS } from '../redis.js';

export default async function handler(req, res) {
    // 🔒 BẢO MẬT: Bắt buộc xác thực quyền Admin để xem thông tin debug
    const auth = req.headers.authorization;
    const adminKey = process.env.ADMIN_SECRET_KEY;
    const queryKey = req.query.secret || req.query.key;

    const isAuthorized = adminKey && (
        (auth && Buffer.from(auth.replace('Bearer ', ''), 'base64').toString() === adminKey) ||
        (queryKey && queryKey === adminKey)
    );

    if (!isAuthorized) {
        return res.status(401).json({ error: 'Unauthorized: Endpoint này chỉ dành cho Quản trị viên' });
    }

    const results = {};
    
    // 1. Test Redis permissions
    const perms = {};
    for (const cmd of ['ping', 'get', 'set', 'hget', 'hset', 'hgetall', 'del']) {
        try {
            if (cmd === 'ping') await redis.ping();
            else if (cmd === 'set') await redis.set('otphub:test_key', '1');
            else if (cmd === 'get') await redis.get('otphub:test_key');
            else if (cmd === 'del') await redis.del('otphub:test_key');
            perms[cmd] = 'OK';
        } catch (e) {
            perms[cmd] = e.message;
        }
    }
    results.redis_permissions = perms;

    // 2. Test Telegram sendMessage (chỉ khi có chat_id hợp lệ từ admin)
    if (req.query.chat_id) {
        try {
            const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
            const chatId = req.query.chat_id;
            const sendResult = await bot.sendMessage(chatId, '✅ Bot đang hoạt động bình thường!');
            results.telegram = { ok: sendResult.ok, result: sendResult.ok ? 'Message sent!' : sendResult.description };
        } catch (e) {
            results.telegram = { ok: false, error: e.message };
        }
    }
    
    // 3. Test Manager & Redis dữ liệu (Ẩn API Key để bảo mật)
    try {
        const allUsersRaw = (await redis.hgetall(KEYS.USERS)) || {};
        const sanitizedUsers = {};
        for (const [k, v] of Object.entries(allUsersRaw)) {
            const u = typeof v === 'object' ? { ...v } : JSON.parse(v);
            if (u.api_key) {
                u.api_key = u.api_key.slice(0, 4) + '****' + u.api_key.slice(-4);
            }
            sanitizedUsers[k] = u;
        }
        results.total_users = Object.keys(sanitizedUsers).length;
        results.users_sample = Object.values(sanitizedUsers).slice(0, 10);
        
        const logs = await redis.lrange('otphub:webhook_logs', 0, 5);
        results.webhook_logs = (logs || []).map(l => { try { return JSON.parse(l); } catch { return l; } });
        
        const errors = await redis.lrange('otphub:webhook_errors', 0, 5);
        results.webhook_errors = (errors || []).map(e => { try { return JSON.parse(e); } catch { return e; } });
    } catch (e) {
        results.manager = { ok: false, error: e.message };
    }

    return res.status(200).json(results);
}

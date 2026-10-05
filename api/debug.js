import { TelegramBot } from '../lib/telegram.js';
import { redis, KEYS } from '../lib/redis.js';

export default async function handler(req, res) {
    const results = {};
    
    // 1. Test Redis permissions
    const perms = {};
    for (const cmd of ['ping', 'get', 'set', 'hget', 'hset', 'hgetall', 'lpush', 'lrange', 'del']) {
        try {
            if (cmd === 'ping') await redis.ping();
            else if (cmd === 'set') await redis.set('otphub:test_key', '1');
            else if (cmd === 'get') await redis.get('otphub:test_key');
            else if (cmd === 'hset') await redis.hset('otphub:test_h', { k: 'v' });
            else if (cmd === 'hget') await redis.hget('otphub:test_h', 'k');
            else if (cmd === 'hgetall') await redis.hgetall('otphub:test_h');
            else if (cmd === 'lpush') await redis.lpush('otphub:test_l', '1');
            else if (cmd === 'lrange') await redis.lrange('otphub:test_l', 0, 1);
            else if (cmd === 'del') await redis.del('otphub:test_key');
            perms[cmd] = 'OK';
        } catch (e) {
            perms[cmd] = e.message;
        }
    }
    results.redis_permissions = perms;

    // 2. Test Telegram sendMessage
    try {
        const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
        // Gửi tin nhắn test tới chính chatId trong query param
        const chatId = req.query.chat_id || '0';
        const sendResult = await bot.sendMessage(chatId, '✅ Bot đang hoạt động!');
        results.telegram = { ok: sendResult.ok, result: sendResult.ok ? 'Message sent!' : sendResult.description };
    } catch (e) {
        results.telegram = { ok: false, error: e.message };
    }
    
    // 3. Test toàn bộ webhook flow
    try {
        const { OTPHubManager, money } = await import('../lib/manager.js');
        const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
        const mgr = new OTPHubManager(bot);
        const testUser = await mgr.getUser({ id: 123456789, first_name: 'Test' });
        results.manager = { ok: true, user: testUser };
        const allUsers = await redis.hgetall(KEYS.USERS);
        results.all_users = allUsers;
        const logs = await redis.lrange('otphub:webhook_logs', 0, 10);
        results.webhook_logs = (logs || []).map(l => { try { return JSON.parse(l); } catch { return l; } });
        const errors = await redis.lrange('otphub:webhook_errors', 0, 10);
        results.webhook_errors = (errors || []).map(e => { try { return JSON.parse(e); } catch { return e; } });
    } catch (e) {
        results.manager = { ok: false, error: e.message, stack: e.stack?.split('\n').slice(0, 3) };
    }

    return res.status(200).json(results);
}

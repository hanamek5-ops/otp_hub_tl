import { TelegramBot } from '../lib/telegram.js';
import { redis, KEYS } from '../lib/redis.js';

export default async function handler(req, res) {
    const results = {};
    
    // 1. Test Redis
    try {
        const ping = await redis.ping();
        results.redis = { ok: true, ping };
    } catch (e) {
        results.redis = { ok: false, error: e.message };
    }

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
    } catch (e) {
        results.manager = { ok: false, error: e.message, stack: e.stack?.split('\n').slice(0, 3) };
    }

    return res.status(200).json(results);
}

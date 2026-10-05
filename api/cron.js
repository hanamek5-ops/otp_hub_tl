import { TelegramBot } from '../lib/telegram.js';
import { OTPHubManager } from '../lib/manager.js';
import { redis, KEYS } from '../lib/redis.js';

export const config = {
    maxDuration: 60 // Giữ function sống trọn 60s trên Vercel
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(req, res) {
    // Chống xung đột giữa các lần gọi Cron
    const acquired = await redis.set(KEYS.CRON_LOCK, 'locked', { nx: true, ex: 55 });
    if (!acquired) {
        return res.status(200).json({ status: 'Another cron cycle is currently executing' });
    }

    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    const mgr = new OTPHubManager(bot);

    const iterations = 6; // 6 chu kỳ x 10s = 60 giây
    let count = 0;

    try {
        for (let i = 0; i < iterations; i++) {
            await mgr.pollMessages();
            count++;
            if (i < iterations - 1) {
                await sleep(10000); // Tạm dừng đúng 10 giây
            }
        }
        await redis.del(KEYS.CRON_LOCK);
        return res.status(200).json({ success: true, cyclesExecuted: count });
    } catch (err) {
        await redis.del(KEYS.CRON_LOCK);
        return res.status(500).json({ error: err.message });
    }
}
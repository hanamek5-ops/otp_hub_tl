import { TelegramBot } from '../lib/telegram.js';
import { OTPHubManager } from '../lib/manager.js';
import { redis, KEYS } from '../lib/redis.js';

export const config = {
    maxDuration: 60
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(req, res) {
    // Chống xung đột giữa các lần gọi Cron (khóa an toàn 30s)
    let acquired = true;
    try {
        acquired = await redis.set(KEYS.CRON_LOCK, 'locked', { nx: true, ex: 30 });
    } catch (e) {
        console.warn('Cron lock warning:', e.message);
    }

    if (acquired === false || acquired === null) {
        return res.status(200).json({ status: 'Another cron cycle is currently executing' });
    }

    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    const mgr = new OTPHubManager(bot);

    const startTime = Date.now();
    // Giới hạn 24s an toàn để luôn trả response trước mốc 30s timeout của cron-job.org
    const MAX_RUN_MS = 24000;
    let cycles = 0;

    try {
        // Tự động kiểm tra và cộng tiền các hoá đơn nạp CheckGD chưa được xử lý
        try {
            await mgr.checkPendingInvoices();
        } catch (invErr) {
            console.error('Cron invoice check warning:', invErr.message);
        }

        while (Date.now() - startTime < MAX_RUN_MS) {
            // pollMessages trả về số đơn đang ở trạng thái waiting
            const waitingCount = await mgr.pollMessages();
            cycles++;

            // Nếu không có đơn nào đang chờ OTP: kết thúc ngay lập tức để phản hồi nhanh và cron-job.org báo XANH 200 OK
            if (!waitingCount || waitingCount === 0) {
                break;
            }

            // Nếu sắp hết 24s thì thoát vòng lặp an toàn
            if (Date.now() - startTime + 1200 >= MAX_RUN_MS) break;

            // Nếu đang có đơn chờ OTP: quét liên tục mỗi 1.2 giây để độ trễ < 2s!
            await sleep(1200);
        }

        try { await redis.del(KEYS.CRON_LOCK); } catch (_) {}
        return res.status(200).json({
            success: true,
            cyclesExecuted: cycles,
            durationSeconds: Number(((Date.now() - startTime) / 1000).toFixed(1))
        });
    } catch (err) {
        try { await redis.del(KEYS.CRON_LOCK); } catch (_) {}
        return res.status(500).json({ error: err.message, cyclesExecuted: cycles });
    }
}
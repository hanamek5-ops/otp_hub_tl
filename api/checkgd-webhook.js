import { TelegramBot } from '../lib/telegram.js';
import { OTPHubManager, money } from '../lib/manager.js';
import { redis } from '../lib/redis.js';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const mgr = new OTPHubManager(bot);

export default async function handler(req, res) {
    // CheckGD hỗ trợ cả GET (query params) và POST (body)
    const data = req.method === 'POST' ? (req.body || {}) : (req.query || {});

    // Ghi log nhận webhook để debug và tra soát
    try {
        await redis.lpush('otphub:checkgd_logs', JSON.stringify({
            time: new Date().toISOString(),
            method: req.method,
            data
        }));
        await redis.ltrim('otphub:checkgd_logs', 0, 50);
    } catch (_) {}

    const status = String(data.status || '').toLowerCase();
    const requestId = data.request_id || data.trans_id;
    const userId = data.merchant_id;
    const received = data.received || data.amount;
    const vndRate = Number(data.vnd_rate) || 26000;
    const vndAmount = Number(data.vnd_amount) || Math.round(Number(received) * vndRate);
    const txId = data.transaction_id || requestId;

    if (status !== 'completed') {
        return res.status(200).json({ success: true, message: `Status is ${status}, no action taken` });
    }

    if (!userId || !requestId) {
        return res.status(400).json({ success: false, error: 'Missing merchant_id or request_id' });
    }

    // Khóa tránh cộng tiền trùng lặp (Idempotency)
    const creditedKey = `otphub:credited:${requestId}`;
    const alreadyCredited = await redis.get(creditedKey);
    if (alreadyCredited) {
        return res.status(200).json({ success: true, message: 'Already credited' });
    }

    try {
        // Cập nhật số dư ví
        const newBalance = await mgr.updateBalance(userId, vndAmount);
        await redis.set(creditedKey, '1', { ex: 86400 * 30 }); // Lưu 30 ngày

        // Gửi thông báo chúc mừng tới khách hàng trên Telegram
        const notifyMsg = (
            `🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💵 Đã nhận: <b>+${received} USDT</b>\n` +
            `💰 Quy đổi: <b>+${money(vndAmount)}</b>\n` +
            `📈 Tỉ giá: <b>${money(vndRate)} / USDT</b>\n` +
            `💰 TK Chính mới: <b>${Number(newBalance).toLocaleString('en-US')} VNĐ</b>\n` +
            `🔗 Mã giao dịch: <code>${txId}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>Hệ thống đã tự động cộng tiền vào tài khoản của bạn. Chúc bạn sử dụng dịch vụ vui vẻ!</i>`
        );

        await bot.sendMessage(userId, notifyMsg, {
            inline_keyboard: [
                [{ text: '🛒 Thuê số OTP ngay', callback_data: 'menu_rent' }],
                [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
            ]
        });

        return res.status(200).json({ success: true, message: 'Balance updated and user notified', newBalance });
    } catch (e) {
        console.error('[CheckGD Webhook Credit Error]:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}

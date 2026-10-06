import { TelegramBot } from '../lib/telegram.js';
import { OTPHubManager, cleanPhone, money, formatPhoneDisplay } from '../lib/manager.js';
import { redis, KEYS } from '../lib/redis.js';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const mgr = new OTPHubManager(bot);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ status: 'GSM Webhook Listener Ready' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (_) {}
        }

        const phone = body?.phone || body?.recipient || body?.receiver || body?.sim_number || '';
        const text = body?.text || body?.message || body?.content || body?.sms || '';
        const sender = body?.sender || body?.from || '';
        const rawOtp = body?.otp || body?.code || '';

        if (!phone || !text) {
            // Vẫn gọi pollMessages phòng trường hợp format khác
            await mgr.pollMessages();
            return res.status(200).json({ received: true, note: 'Polled messages' });
        }

        const cleanP = cleanPhone(phone);
        const sessions = (await redis.lrange(KEYS.SESSIONS, 0, 100)) || [];
        const waiting = sessions.filter(s => s.status === 'waiting');
        const targetSession = waiting.find(s => cleanPhone(s.phone_number) === cleanP);

        if (!targetSession) {
            return res.status(200).json({ received: true, match: false });
        }

        const reg = targetSession.service_pattern ? new RegExp(targetSession.service_pattern, 'i') : null;
        const fullTxt = `${sender} ${text}`;

        if (targetSession.service_id === 'shopee' && /shopee\s*food|foody|\bnow\b/i.test(fullTxt)) {
            return res.status(200).json({ match: false, reason: 'shopeefood_ignored' });
        }
        if (reg && !reg.test(fullTxt)) {
            return res.status(200).json({ match: false, reason: 'pattern_mismatch' });
        }

        const otp = mgr.extractOtp(rawOtp, text);
        if (!otp) {
            return res.status(200).json({ match: false, reason: 'no_otp_found' });
        }

        const now = Date.now();
        targetSession.status = 'success';
        targetSession.otp = otp;
        targetSession.otp_code = otp;
        targetSession.sms_text = text;
        targetSession.received_at = now;
        targetSession.cooldown = now + 60 * 1000;

        await redis.del(KEYS.SESSIONS);
        if (sessions.length) await redis.rpush(KEYS.SESSIONS, ...sessions);

        // Bắn tin nhắn Telegram tức thì (< 0.2s)
        const msgText = (
            `⚡ <b>BẠN ĐÃ NHẬN ĐƯỢC MÃ OTP TỨC THÌ!</b> ⚡\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📱 Số điện thoại: <code>${targetSession.phone_number}</code>\n` +
            `🔑 Mã OTP: <code>${otp}</code> <i>(Chạm để copy)</i>\n` +
            `🏢 Dịch vụ: <b>${targetSession.service_name}</b>\n` +
            `📩 Tin nhắn SMS: <i>"${text}"</i>\n` +
            `━━━━━━━━━━━━━━━━━━━━`
        );
        const replyMarkup = {
            inline_keyboard: [
                [{ text: '🔄 Thuê lại số này', callback_data: `rerent_${targetSession.phone_number}_${targetSession.service_id}` }],
                [{ text: '🛒 Thuê số khác', callback_data: 'menu_rent' }]
            ]
        };
        await bot.sendMessage(targetSession.user_id, msgText, replyMarkup);

        return res.status(200).json({ success: true, matched: true, otp });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

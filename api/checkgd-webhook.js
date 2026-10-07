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
    const requestId = String(data.request_id || '').trim();
    const merchantId = String(data.merchant_id || '').trim();
    const incomingApiKey = String(data.api_key || '').trim();
    const configuredApiKey = await mgr.getCheckGdApiKey();

    // 1. Kiểm tra API Key CheckGD (nếu webhook có gửi kèm api_key)
    if (incomingApiKey && configuredApiKey && incomingApiKey !== configuredApiKey) {
        console.warn('[CheckGD Webhook] API Key không khớp:', incomingApiKey);
        return res.status(403).json({ success: false, error: 'Invalid API Key' });
    }

    if (status && status !== 'completed') {
        return res.status(200).json({ success: true, message: `Status is ${status}, no action taken` });
    }

    // 2. Tìm mã hoá đơn trans_id chuẩn của CheckGD
    let transId = String(data.trans_id || '').trim();

    // Nếu callback không gửi trans_id trực tiếp, tra cứu qua request_id trong Redis index
    if (!transId && requestId) {
        try {
            transId = await redis.get(`otphub:req_to_inv:${requestId}`);
        } catch (_) {}
    }

    // Nếu vẫn chưa có, quét trong otphub:invoice:* đã lưu
    if (!transId && requestId) {
        try {
            const invoiceKeys = await redis.keys('otphub:invoice:*');
            for (const key of invoiceKeys) {
                const inv = await redis.get(key);
                if (inv && (inv.request_id === requestId || inv.trans_id === requestId)) {
                    transId = inv.trans_id;
                    break;
                }
            }
        } catch (_) {}
    }

    // 3. Khóa chống cộng trùng lặp (Idempotency)
    const lockKeys = [];
    if (transId) lockKeys.push(`otphub:credited:${transId}`);
    if (requestId) lockKeys.push(`otphub:credited:${requestId}`);
    if (data.transaction_id && data.transaction_id !== 'manual') {
        lockKeys.push(`otphub:credited:${data.transaction_id}`);
    }

    for (const lk of lockKeys) {
        const already = await redis.get(lk);
        if (already) {
            return res.status(200).json({ success: true, message: 'Hoá đơn này đã được cộng tiền trước đó' });
        }
    }

    // 4. Tra soát 2 chiều với Server CheckGD nếu có trans_id
    let verifiedInvoice = null;
    if (transId) {
        try {
            const verifyRes = await fetch(`https://checkgd.vn/api/v1/invoices/${encodeURIComponent(transId)}`, {
                headers: { 'Accept': 'application/json' }
            });
            const verifyData = await verifyRes.json();
            if (verifyData?.success && verifyData?.data) {
                verifiedInvoice = verifyData.data;
            }
        } catch (e) {
            console.error('[CheckGD Verify Fetch Error]:', e.message);
        }
    }

    // Xác thực an toàn: Hoặc là tra soát thành công với CheckGD API, hoặc callback gửi kèm đúng API Key bí mật của Merchant
    const isSecretVerified = Boolean(incomingApiKey && configuredApiKey && incomingApiKey === configuredApiKey);
    if (!verifiedInvoice && !isSecretVerified) {
        console.warn(`[CheckGD Webhook Warning] Không thể xác thực hoá đơn: transId=${transId}, reqId=${requestId}`);
        return res.status(400).json({ success: false, error: 'Không thể xác thực hoá đơn hoặc giao dịch không hợp lệ' });
    }

    const verifiedStatus = String(verifiedInvoice?.status || status).toLowerCase();
    if (verifiedStatus !== 'completed') {
        return res.status(200).json({
            success: true,
            message: `Hoá đơn chưa hoàn tất (Trạng thái hiện tại: ${verifiedStatus})`
        });
    }

    // Lấy thêm cached invoice nếu có trong Redis
    let cachedInv = null;
    if (transId) {
        try {
            cachedInv = await redis.get(`otphub:invoice:${transId}`);
        } catch (_) { }
    }

    // Lấy thông tin thanh toán chuẩn xác (Ưu tiên params thực nhận từ webhook callback của CheckGD)
    const finalUserId = String(data.merchant_id || merchantId || cachedInv?.user_id || verifiedInvoice?.merchant_id || '').trim();
    const finalReceived = Number(data.received || data.amount || cachedInv?.amount || verifiedInvoice?.amount || 0);
    const finalVndRate = Number(data.vnd_rate || cachedInv?.vnd_rate || verifiedInvoice?.vnd_rate || 26000);
    const finalVndAmount = Number(data.vnd_amount) || Number(cachedInv?.vnd_amount) || Number(verifiedInvoice?.vnd_amount) || Math.round(finalReceived * finalVndRate);

    if (!finalUserId || isNaN(finalVndAmount) || finalVndAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Dữ liệu hoá đơn không hợp lệ' });
    }

    // Đặt khóa tránh trùng lặp
    const primaryLock = lockKeys[0] || `otphub:credited:${requestId}`;
    const acquired = await redis.set(primaryLock, '1', { nx: true, ex: 86400 * 30 }); // 30 ngày
    if (!acquired) {
        return res.status(200).json({ success: true, message: 'Hoá đơn này đã được cộng tiền trước đó' });
    }
    for (let i = 1; i < lockKeys.length; i++) {
        await redis.set(lockKeys[i], '1', { ex: 86400 * 30 });
    }

    try {
        // Cập nhật số dư ví
        const newBalance = await mgr.updateBalance(finalUserId, finalVndAmount);

        // Gửi thông báo chúc mừng tới khách hàng trên Telegram
        const displayCode = transId || requestId || data.transaction_id || 'GD';
        const notifyMsg = (
            `🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💵 Đã nhận: <b>+${finalReceived} USDT</b>\n` +
            `💰 Quy đổi: <b>+${money(finalVndAmount)}</b>\n` +
            `📈 Tỉ giá: <b>${money(finalVndRate)} / USDT</b>\n` +
            `💰 TK Chính mới: <b>${Number(newBalance).toLocaleString('en-US')} VNĐ</b>\n` +
            `🔗 Mã giao dịch: <code>${displayCode}</code>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>Hệ thống đã tự động cộng tiền vào tài khoản của bạn. Chúc bạn sử dụng dịch vụ vui vẻ!</i>`
        );

        await bot.sendMessage(finalUserId, notifyMsg, {
            inline_keyboard: [
                [{ text: '🛒 Thuê số OTP ngay', callback_data: 'menu_rent' }],
                [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
            ]
        });

        return res.status(200).json({
            success: true,
            message: 'Balance updated and user notified',
            newBalance
        });
    } catch (e) {
        // Nếu lỗi hệ thống khi cộng tiền, xóa khóa để webhook có thể retry
        for (const lk of lockKeys) {
            await redis.del(lk);
        }
        console.error('[CheckGD Webhook Credit Error]:', e);
        return res.status(500).json({ success: false, error: e.message });
    }
}

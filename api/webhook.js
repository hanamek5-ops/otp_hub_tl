import { TelegramBot, escapeHtml } from '../lib/telegram.js';
import { OTPHubManager, money, formatPhoneDisplay } from '../lib/manager.js';
import { redis } from '../lib/redis.js';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const mgr = new OTPHubManager(bot);

function getApiKeyMessage(user) {
    return (
        `🔑 <b>API KEY CHO THUÊ SỐ (OTPHUB)</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 ID Telegram: <code>${user.id}</code>\n` +
        `💰 Số dư ví: <b>${money(user.balance)}</b>\n\n` +
        `📌 <b>API Key (Token) của bạn:</b>\n` +
        `<code>${user.api_key}</code>\n` +
        `<i>(Chạm vào mã trên để sao chép vào tool)</i>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 <b>HƯỚNG DẪN TÍCH HỢP TOOL (OTPHUB API):</b>\n\n` +
        `🔹 <b>1. Kiểm tra số dư:</b>\n` +
        `<code>GET /users/balance?token=${user.api_key}</code>\n\n` +
        `🔹 <b>2. Danh sách dịch vụ & giá:</b>\n` +
        `<code>GET /service/getv2?token=${user.api_key}</code>\n\n` +
        `🔹 <b>3. Yêu cầu thuê số (Cấp SIM):</b>\n` +
        `<code>GET /request/getv2?token=${user.api_key}&serviceId=shopee</code>\n\n` +
        `🔹 <b>4. Lấy mã OTP / Trạng thái:</b>\n` +
        `<code>GET /session/getv2?requestId={ID}&token=${user.api_key}</code>\n\n` +
        `🔹 <b>5. Hủy số khi chưa có mã (Hoàn tiền):</b>\n` +
        `<code>GET /session/cancel?requestId={ID}&token=${user.api_key}</code>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>💡 Khi bên thứ 3 hoặc tool của bạn nhận được OTP, bot vẫn sẽ tự động gửi mã về đây cho bạn theo dõi!</i>`
    );
}

function getHelpMessage(user, isAdmin) {
    let msg = (
        `📖 <b>DANH SÁCH LỆNH & HƯỚNG DẪN SỬ DỤNG BOT</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 <b>LỆNH CHO KHÁCH HÀNG:</b>\n` +
        `🔹 <code>/start</code> hoặc <code>menu</code>\n` +
        `   👉 Mở Menu điều khiển chính của Bot.\n\n` +
        `🔹 <code>/rent</code> hoặc <code>thuê số</code>\n` +
        `   👉 Mở danh sách dịch vụ và chọn thuê số nhận mã OTP.\n\n` +
        `🔹 <code>/deposit</code> hoặc <code>/naptien</code> hoặc <code>nạp tiền</code>\n` +
        `   👉 Nạp tiền tự động vào ví qua USDT (Cổng CheckGD).\n\n` +
        `🔹 <code>/balance</code> hoặc <code>/sodu</code>\n` +
        `   👉 Xem số dư tiền trong ví tài khoản của bạn.\n\n` +
        `🔹 <code>/apikey</code> hoặc <code>/token</code>\n` +
        `   👉 Lấy mã API Key & hướng dẫn cắm tool tự động.\n\n` +
        `🔹 <code>/support</code> hoặc <code>hỗ trợ</code>\n` +
        `   👉 Xem thông tin liên hệ Admin để nạp tiền & hỗ trợ 24/7.\n\n` +
        `🔹 <code>/help</code> hoặc <code>/huongdan</code>\n` +
        `   👉 Hiển thị bảng danh sách lệnh hướng dẫn này.`
    );

    if (isAdmin) {
        msg += (
            `\n\n━━━━━━━━━━━━━━━━━━━━\n` +
            `⚡ <b>LỆNH DÀNH CHO ADMIN:</b>\n` +
            `👑 <code>/admin</code>\n` +
            `   👉 Mở bảng thống kê tổng quan (khách hàng, số dư, doanh thu).\n\n` +
            `👑 <code>/addmoney &lt;id_hoặc_@username&gt; &lt;số_tiền&gt;</code>\n` +
            `   👉 Nạp/Trừ tiền ví người dùng (VD: <code>/addmoney ${user.id} 50k</code> hoặc <code>/add @username 100k</code>).\n\n` +
            `👑 <code>/checkuser &lt;id_hoặc_@username&gt;</code>\n` +
            `   👉 Tra cứu thông tin, username & số dư ví của khách.\n\n` +
            `👑 <code>/checkshopee</code>\n` +
            `   👉 Quét toàn bộ dàn modem GSM để lọc danh sách SIM zin Shopee.`
        );
    }

    msg += `\n\n━━━━━━━━━━━━━━━━━━━━\n<i>💡 Hệ thống cam kết tự động hoàn tiền 100% nếu sau 10 phút không có mã OTP!</i>`;
    return msg;
}

async function sendDepositMenu(chatId, user, editMessageId = null) {
    const rate = await mgr.getExchangeRate();
    const text = (
        `💳 <b>NẠP TIỀN TỰ ĐỘNG QUA CỔNG USDT (CHECKGD)</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Tài khoản: <b>${escapeHtml(user.name)}</b> (ID: <code>${user.id}</code>)\n` +
        `💰 TK Chính hiện tại: <b>${Number(user.balance || 0).toLocaleString('en-US')} VNĐ</b>\n` +
        `📈 Tỉ giá Binance P2P: <b>${money(rate)} / USDT</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👉 <i>Hệ thống tự động cộng tiền trong 15-30 giây khi thanh toán thành công!</i>\n\n` +
        `Chọn số lượng USDT bạn muốn nạp:`
    );
    const kb = {
        inline_keyboard: [
            [
                { text: `💵 2 USDT (~${money(2 * rate)})`, callback_data: 'deposit_pkg_2' },
                { text: `💵 5 USDT (~${money(5 * rate)})`, callback_data: 'deposit_pkg_5' }
            ],
            [
                { text: `💵 10 USDT (~${money(10 * rate)})`, callback_data: 'deposit_pkg_10' },
                { text: `💵 20 USDT (~${money(20 * rate)})`, callback_data: 'deposit_pkg_20' }
            ],
            [
                { text: `💵 50 USDT (~${money(50 * rate)})`, callback_data: 'deposit_pkg_50' },
                { text: `💵 100 USDT (~${money(100 * rate)})`, callback_data: 'deposit_pkg_100' }
            ],
            [{ text: '✍️ Nhập số USDT tuỳ chọn', callback_data: 'deposit_custom' }],
            [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
        ]
    };

    if (editMessageId) {
        return bot.editMessage(chatId, editMessageId, text, kb);
    } else {
        return bot.sendMessage(chatId, text, kb);
    }
}

async function handleCreateDepositInvoice(chatId, user, amountUsdt) {
    const res = await mgr.createCheckGdInvoice({ userId: user.id, amountUsdt });
    if (!res.success || !res.invoice) {
        return bot.sendMessage(chatId, `❌ <b>Không thể tạo hoá đơn:</b>\n\n${res.msg || 'Lỗi kết nối CheckGD'}`);
    }

    const inv = res.invoice;
    const rate = inv.vnd_rate || (await mgr.getExchangeRate());
    const vndAmt = inv.vnd_amount || Math.round(inv.amount * rate);
    const msgText = (
        `🧾 <b>HOÁ ĐƠN NẠP TIỀN USDT (CHECKGD)</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 Mã hoá đơn: <code>${inv.trans_id}</code>\n` +
        `💵 Số USDT cần chuyển: <code>${inv.amount}</code> USDT <i>(Chạm để copy)</i>\n` +
        `💰 Quy đổi vào ví: <b>${money(vndAmt)}</b>\n` +
        `📈 Tỉ giá: <b>${money(rate)} / USDT</b>\n` +
        `⏱ Thời hạn thanh toán: <b>60 phút</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        (inv.payment_address ? `📌 Địa chỉ ví nhận (TRC20):\n<code>${inv.payment_address}</code>\n━━━━━━━━━━━━━━━━━━━━\n` : '') +
        `👉 <b>HƯỚNG DẪN THANH TOÁN:</b>\n` +
        `1. Bấm nút <b>"🌐 Mở trang thanh toán Checkout"</b> bên dưới để quét QR hoặc chuyển qua Binance Pay / BEP20 / TRC20.\n` +
        `2. Hoặc chuyển chính xác <code>${inv.amount}</code> USDT tới địa chỉ ví TRC20 phía trên.\n` +
        `3. Sau khi chuyển xong, hệ thống tự động cộng tiền trong 15-30 giây!`
    );
    const kb = {
        inline_keyboard: [
            [{ text: '🌐 Mở trang thanh toán Checkout', url: inv.checkout_url }],
            [{ text: '⚡ Kiểm tra thanh toán', callback_data: `check_dep_${inv.trans_id}` }],
            [{ text: '➕ Nạp số khác', callback_data: 'menu_deposit' }, { text: '◀️ Menu chính', callback_data: 'menu_main' }]
        ]
    };
    return bot.sendMessage(chatId, msgText, kb);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send('Bot Running');
    let update = req.body;
    if (Buffer.isBuffer(update)) {
        try {
            update = JSON.parse(update.toString('utf8'));
        } catch (e) {
            console.error('Error parsing Buffer body:', e);
        }
    } else if (typeof update === 'string') {
        try {
            update = JSON.parse(update);
        } catch (e) {
            console.error('Error parsing JSON body:', e);
        }
    }
    if (!update) return res.status(200).send('No update');

    // Debug logging to Redis
    try {
        await redis.lpush('otphub:webhook_logs', JSON.stringify({
            time: new Date().toISOString(),
            update_id: update.update_id,
            type: update.message ? 'message' : (update.callback_query ? 'callback' : 'other'),
            from: update.message?.from || update.callback_query?.from,
            text: update.message?.text || update.callback_query?.data
        }));
        await redis.ltrim('otphub:webhook_logs', 0, 19);
    } catch (_) {}

    try {
        // 1. Xử lý Message Text
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = (msg.text || '').trim();
            const fromUser = msg.from || msg.chat;
            const user = await mgr.getUser(fromUser);
            const isAdmin = await mgr.isAdmin(fromUser.id);

            if (msg.chat.type !== 'private') {
                if (text.startsWith('/')) {
                    await bot.sendMessage(chatId, '🔒 Vì lý do bảo mật mã OTP và số dư ví, vui lòng chat riêng 1-1 với Bot!');
                }
                return res.status(200).json({ ok: true });
            }

            // Kiểm tra trạng thái nhập số tiền USDT tuỳ chọn
            const userState = await redis.get(`otphub:state:${user.id}`);
            if (userState === 'awaiting_deposit_usdt') {
                if (text === '/cancel' || text.toLowerCase() === 'hủy' || text.toLowerCase() === 'cancel') {
                    await redis.del(`otphub:state:${user.id}`);
                    await bot.sendMessage(chatId, '❌ Đã huỷ thao tác nhập số tiền nạp.');
                    return res.status(200).json({ ok: true });
                }
                const cleanNum = text.replace(',', '.').replace(/usdt/i, '').trim();
                const val = parseFloat(cleanNum);
                if (!isNaN(val) && val >= 1) {
                    await redis.del(`otphub:state:${user.id}`);
                    await bot.sendMessage(chatId, `⏳ Đang tạo hoá đơn nạp <b>${val} USDT</b>...`);
                    await handleCreateDepositInvoice(chatId, user, val);
                    return res.status(200).json({ ok: true });
                } else {
                    await bot.sendMessage(chatId, '⚠️ Số lượng USDT không hợp lệ! Vui lòng nhập số từ 1 trở lên (Ví dụ: <code>5</code> hoặc <code>10.5</code>).\nHoặc gõ <code>/cancel</code> để huỷ.');
                    return res.status(200).json({ ok: true });
                }
            }

            if (text === '/deposit' || text === '/naptien' || text.toLowerCase() === 'nạp tiền' || text.toLowerCase() === 'nap tien') {
                await sendDepositMenu(chatId, user);
                return res.status(200).json({ ok: true });
            }

            if (text.startsWith('/start') || text.toLowerCase() === 'menu') {
                const displayName = escapeHtml(user.name);
                const welcomeText = (
                    `👋 <b>Xin chào, ${displayName}!</b>\n` +
                    `Chào mừng bạn đến với <b>OTP HUB GSM</b> ⚡\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `👤 ID Telegram: <code>${user.id}</code>\n` +
                    `💰 Số dư ví: <b>${money(user.balance)}</b>\n` +
                    `🔑 API Key: <code>${user.api_key}</code>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `🔹 <i>Shopee: Tự động lọc 100% SỐ ZIN chưa đăng ký.</i>\n` +
                    `🔹 <i>Tự động hoàn tiền 100% nếu sau 10 phút không có mã OTP.</i>\n` +
                    `🔹 <i>Hỗ trợ <b>Thuê lại số cũ</b> & Cung cấp <b>API Tự Động</b> cho tool!</i>`
                );
                const kb = {
                    inline_keyboard: [
                        [{ text: '🛒 Thuê số OTP ngay', callback_data: 'menu_rent' }, { text: '💳 Nạp tiền USDT', callback_data: 'menu_deposit' }],
                        [{ text: '🔄 Thuê lại số cũ đã dùng', callback_data: 'menu_old_numbers' }],
                        [{ text: '🔑 Lấy API Key', callback_data: 'menu_apikey' }, { text: '💰 Số dư ví', callback_data: 'menu_balance' }],
                        [{ text: '📖 Hướng dẫn lệnh', callback_data: 'menu_help' }, { text: '💬 Liên hệ hỗ trợ', callback_data: 'menu_support' }]
                    ]
                };
                await bot.sendMessage(chatId, welcomeText, kb);
                return res.status(200).json({ ok: true });
            }

            if (text === '/help' || text === '/huongdan' || text.toLowerCase() === 'help' || text.toLowerCase() === 'hướng dẫn') {
                const helpText = getHelpMessage(user, isAdmin);
                const kb = {
                    inline_keyboard: [
                        [{ text: '🛒 Thuê số ngay', callback_data: 'menu_rent' }, { text: '💳 Nạp tiền USDT', callback_data: 'menu_deposit' }],
                        [{ text: '🔑 Lấy API Key', callback_data: 'menu_apikey' }, { text: '◀️ Menu chính', callback_data: 'menu_main' }]
                    ]
                };
                await bot.sendMessage(chatId, helpText, kb);
                return res.status(200).json({ ok: true });
            }

            if (text === '/apikey' || text === '/token' || text.toLowerCase() === 'api key') {
                const apiKeyText = getApiKeyMessage(user);
                const kb = {
                    inline_keyboard: [
                        [{ text: '🔄 Đổi API Key mới', callback_data: 'regen_apikey' }],
                        [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                    ]
                };
                await bot.sendMessage(chatId, apiKeyText, kb);
                return res.status(200).json({ ok: true });
            }

            if (text === '/balance' || text === '/sodu' || text.toLowerCase() === 'số dư') {
                await bot.sendMessage(
                    chatId,
                    `💰 Số dư TK Chính của bạn: <b>${Number(user.balance || 0).toLocaleString('en-US')} VNĐ</b>`,
                    {
                        inline_keyboard: [
                            [{ text: '💳 Nạp tiền USDT ngay', callback_data: 'menu_deposit' }],
                            [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                        ]
                    }
                );
                return res.status(200).json({ ok: true });
            }

            if (text === '/support' || text.toLowerCase() === 'support' || text.toLowerCase() === 'hỗ trợ') {
                const cfg = await mgr.getConfig();
                const contact = (cfg.admin_contact || '').trim();
                const contactUrl = contact ? (contact.startsWith('http') ? contact : `https://t.me/${contact.replace(/^@/, '')}`) : '';
                const kb = {
                    inline_keyboard: [
                        ...(contactUrl ? [[{ text: '💬 Nhắn tin Admin', url: contactUrl }]] : []),
                        [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                    ]
                };
                await bot.sendMessage(chatId, `💬 <b>HỖ TRỢ KHÁCH HÀNG:</b>\n\nAdmin: <code>${contact || 'Chưa cập nhật'}</code>\nThời gian phản hồi: 24/7\n\n<i>👉 Vui lòng liên hệ Admin nếu bạn cần nạp tiền ví hoặc hỗ trợ kỹ thuật!</i>`, kb);
                return res.status(200).json({ ok: true });
            }

            if (text === '/rent' || text === '📱 Thuê số' || text.toLowerCase() === 'thuê số') {
                const services = await mgr.getServices();
                const rows = [];
                let curr = [];
                for (const s of services) {
                    if (!s.enabled) continue;
                    curr.push({ text: `${s.icon} ${s.name} (${money(s.price)})`, callback_data: `rent_${s.id}` });
                    if (curr.length === 2) {
                        rows.push(curr);
                        curr = [];
                    }
                }
                if (curr.length) rows.push(curr);
                rows.push([{ text: '◀️ Quay lại Menu', callback_data: 'menu_main' }]);
                await bot.sendMessage(chatId, '🛒 <b>CHỌN DỊCH VỤ CẦN THUÊ SỐ:</b>\n<i>Hệ thống cam kết hoàn tiền 100% nếu không nhận được mã.</i>', { inline_keyboard: rows });
                return res.status(200).json({ ok: true });
            }

            // Lệnh Admin Menu
            if (text === '/admin') {
                if (!isAdmin) {
                    await bot.sendMessage(chatId, (
                        `⛔ <b>Bạn không có quyền truy cập Admin!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `👤 ID Telegram của bạn: <code>${user.id}</code>\n\n` +
                        `<i>👉 Để cấp quyền, hãy thêm ID <code>${user.id}</code> vào biến <b>ADMIN_IDS</b> trên Vercel Settings -> Environment Variables.</i>`
                    ));
                    return res.status(200).json({ ok: true });
                }

                const allUsers = Object.values((await (await import('../lib/redis.js')).redis.hgetall('otphub:users')) || {});
                const totalBalance = allUsers.reduce((sum, u) => sum + (u.balance || 0), 0);
                const sessions = (await (await import('../lib/redis.js')).redis.lrange('otphub:sessions', 0, 500)) || [];
                const successCount = sessions.filter(s => s.status === 'success').length;

                const adminMsg = (
                    `⚡ <b>BẢNG ĐIỀU KHIỂN QUẢN TRỊ VIÊN</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `👥 Tổng khách hàng: <b>${allUsers.length}</b>\n` +
                    `💰 Tổng số dư các ví: <b>${money(totalBalance)}</b>\n` +
                    `📱 Phiên OTP thành công: <b>${successCount} / ${sessions.length}</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `🛠 <b>CÁC LỆNH ADMIN TELEGRAM:</b>\n` +
                    `🔹 <code>/addmoney &lt;id_hoặc_@username&gt; &lt;số_tiền&gt;</code>\n` +
                    `   <i>Ví dụ:</i> <code>/addmoney ${user.id} 50k</code>\n` +
                    `   <i>Hoặc:</i> <code>/add @username 100k</code>\n` +
                    `🔹 <code>/checkuser &lt;id_hoặc_@username&gt;</code>\n` +
                    `   <i>Xem số dư & thông tin người dùng</i>\n` +
                    `🔹 <code>/admin</code>: Mở bảng quản trị này\n\n` +
                    `🌐 <b>Web Admin Dashboard:</b> Đăng nhập tại website Vercel bằng <code>ADMIN_SECRET_KEY</code>`
                );
                await bot.sendMessage(chatId, adminMsg);
                return res.status(200).json({ ok: true });
            }

            // Lệnh Admin kiểm tra user
            if (isAdmin && text.startsWith('/checkuser')) {
                const parts = text.split(/\s+/);
                if (parts.length >= 2) {
                    const search = parts[1].replace(/^@/, '').toLowerCase();
                    const allUsers = (await (await import('../lib/redis.js')).redis.hgetall('otphub:users')) || {};
                    let target = allUsers[search] || Object.values(allUsers).find(u => u.username?.toLowerCase() === search);
                    if (target) {
                        await bot.sendMessage(chatId, (
                            `👤 <b>Thông tin User:</b>\n` +
                            `━━━━━━━━━━━━━━━━━━━━\n` +
                            `ID: <code>${target.id}</code>\n` +
                            `Tên: <b>${target.name || 'Không rõ'}</b>\n` +
                            `Username: <b>${target.username ? '@' + target.username : 'Không có'}</b>\n` +
                            `💰 Số dư: <b>${money(target.balance)}</b>\n` +
                            `📅 Ngày tạo: <code>${target.created_at || 'N/A'}</code>`
                        ));
                        return res.status(200).json({ ok: true });
                    } else {
                        await bot.sendMessage(chatId, `❌ Không tìm thấy người dùng <code>${parts[1]}</code> trong cơ sở dữ liệu.`);
                        return res.status(200).json({ ok: true });
                    }
                }
                await bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/checkuser <id_hoặc_@username></code>');
                return res.status(200).json({ ok: true });
            }

            // Lệnh Admin cộng tiền
            if (isAdmin && (text.startsWith('/addmoney') || text.startsWith('/add '))) {
                const parts = text.split(/\s+/);
                if (parts.length >= 3) {
                    const target = parts[1];
                    const rawAmt = parts[2].toLowerCase().replace('k', '000').replace('m', '000000');
                    const amt = parseInt(rawAmt, 10);
                    if (target && !isNaN(amt)) {
                        const newBal = await mgr.updateBalance(target, amt);
                        await bot.sendMessage(chatId, `✅ Đã cập nhật tiền cho <code>${target}</code>: <b>${amt > 0 ? '+' : ''}${money(amt)}</b>\n💳 Số dư mới: <b>${money(newBal)}</b>`);
                        return res.status(200).json({ ok: true });
                    }
                }
                await bot.sendMessage(chatId, '⚠️ Cú pháp: <code>/addmoney <id_hoặc_@username> 50k</code>');
                return res.status(200).json({ ok: true });
            }

            // Lệnh Admin quét số zin Shopee
            if (isAdmin && text.startsWith('/checkshopee')) {
                await bot.sendMessage(chatId, '⏳ Đang quét danh sách SIM và check số zin Shopee qua OtisTx...');
                const { unreg, reg } = await mgr.checkShopeeAllModems();
                const out = (
                    `📊 <b>KẾT QUẢ CHECK SỐ ZIN SHOPEE:</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `✅ <b>Số ZIN chưa đăng ký (${unreg.length}):</b>\n` +
                    (unreg.length ? unreg.slice(0, 30).map(p => `• <code>${p}</code>`).join('\n') : '<i>Không có</i>') +
                    `\n\n❌ <b>Số ĐÃ ĐĂNG KÝ (${reg.length}):</b>\n` +
                    (reg.length ? reg.slice(0, 30).map(p => `• <code>${p}</code>`).join('\n') : '<i>Không có</i>')
                );
                await bot.sendMessage(chatId, out);
                return res.status(200).json({ ok: true });
            }
        }

        // 2. Xử lý Callback Query
        if (update.callback_query) {
            const cq = update.callback_query;
            const chatId = cq.message.chat.id;
            const messageId = cq.message.message_id;
            const data = cq.data;
            const userId = cq.from.id;

            if (data === 'menu_main') {
                await bot.answerCallbackQuery(cq.id);
                const user = await mgr.getUser(cq.from);
                const text = (
                    `👋 <b>Menu chính OTP HUB</b>\n` +
                    `👤 ID: <code>${user.id}</code> | 💰 Số dư: <b>${money(user.balance)}</b>`
                );
                const kb = {
                    inline_keyboard: [
                        [{ text: '🛒 Thuê số OTP ngay', callback_data: 'menu_rent' }, { text: '💳 Nạp tiền USDT', callback_data: 'menu_deposit' }],
                        [{ text: '🔄 Thuê lại số cũ đã dùng', callback_data: 'menu_old_numbers' }],
                        [{ text: '🔑 Lấy API Key', callback_data: 'menu_apikey' }, { text: '💰 Số dư ví', callback_data: 'menu_balance' }],
                        [{ text: '📖 Hướng dẫn lệnh', callback_data: 'menu_help' }, { text: '💬 Liên hệ hỗ trợ', callback_data: 'menu_support' }]
                    ]
                };
                await bot.editMessage(chatId, messageId, text, kb);
                return res.status(200).json({ ok: true });
            }

            if (data === 'menu_help') {
                await bot.answerCallbackQuery(cq.id);
                const user = await mgr.getUser(cq.from);
                const isAdm = await mgr.isAdmin(cq.from.id);
                const text = getHelpMessage(user, isAdm);
                const kb = {
                    inline_keyboard: [
                        [{ text: '🛒 Thuê số ngay', callback_data: 'menu_rent' }, { text: '💳 Nạp tiền USDT', callback_data: 'menu_deposit' }],
                        [{ text: '🔑 Lấy API Key', callback_data: 'menu_apikey' }, { text: '◀️ Menu chính', callback_data: 'menu_main' }]
                    ]
                };
                await bot.editMessage(chatId, messageId, text, kb);
                return res.status(200).json({ ok: true });
            }

            if (data === 'menu_apikey') {
                await bot.answerCallbackQuery(cq.id);
                const user = await mgr.getUser(cq.from);
                const text = getApiKeyMessage(user);
                const kb = {
                    inline_keyboard: [
                        [{ text: '🔄 Đổi API Key mới', callback_data: 'regen_apikey' }],
                        [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                    ]
                };
                await bot.editMessage(chatId, messageId, text, kb);
                return res.status(200).json({ ok: true });
            }

            if (data === 'regen_apikey') {
                await mgr.generateNewApiKey(userId);
                const freshUser = await mgr.getUser(cq.from);
                await bot.answerCallbackQuery(cq.id, '✅ Đã tạo mã API Key mới thành công!', true);
                const text = getApiKeyMessage(freshUser);
                const kb = {
                    inline_keyboard: [
                        [{ text: '🔄 Đổi API Key mới', callback_data: 'regen_apikey' }],
                        [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                    ]
                };
                await bot.editMessage(chatId, messageId, text, kb);
                return res.status(200).json({ ok: true });
            }

            if (data === 'menu_balance') {
                const user = await mgr.getUser(cq.from);
                await bot.answerCallbackQuery(cq.id, `Số dư: ${money(user.balance)}`, true);
                return res.status(200).json({ ok: true });
            }

            if (data === 'menu_support') {
                await bot.answerCallbackQuery(cq.id);
                const cfg = await mgr.getConfig();
                const contact = (cfg.admin_contact || '').trim();
                if (contact) {
                    const contactUrl = contact.startsWith('http') ? contact : `https://t.me/${contact.replace(/^@/, '')}`;
                    await bot.editMessage(chatId, messageId, `💬 <b>HỖ TRỢ KHÁCH HÀNG:</b>\n\nAdmin: <code>${contact}</code>\nThời gian phản hồi: 24/7`, {
                        inline_keyboard: [
                            [{ text: '💬 Nhắn tin Admin', url: contactUrl }],
                            [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                        ]
                    });
                } else {
                    await bot.editMessage(chatId, messageId, `💬 <b>HỖ TRỢ KHÁCH HÀNG:</b>\n\n<i>Hiện tại hệ thống hỗ trợ trực tiếp đang tạm đóng hoặc chưa cập nhật. Vui lòng quay lại sau!</i>`, {
                        inline_keyboard: [
                            [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                        ]
                    });
                }
                return res.status(200).json({ ok: true });
            }

            // Menu chọn dịch vụ thuê số mới
            if (data === 'menu_rent') {
                await bot.answerCallbackQuery(cq.id);
                const services = await mgr.getServices();
                const rows = [];
                let curr = [];
                for (const s of services) {
                    if (!s.enabled) continue;
                    curr.push({ text: `${s.icon} ${s.name} (${money(s.price)})`, callback_data: `rent_${s.id}` });
                    if (curr.length === 2) {
                        rows.push(curr);
                        curr = [];
                    }
                }
                if (curr.length) rows.push(curr);
                rows.push([{ text: '◀️ Quay lại Menu', callback_data: 'menu_main' }]);

                await bot.editMessage(chatId, messageId, '🛒 <b>CHỌN DỊCH VỤ CẦN THUÊ SỐ:</b>\n<i>Hệ thống cam kết hoàn tiền 100% nếu không nhận được mã.</i>', { inline_keyboard: rows });
                return res.status(200).json({ ok: true });
            }

            // Xử lý thuê số mới (Bấm ở trên sẽ bắn tin nhắn số mới xuống dưới, menu trên giữ nguyên để bấm tiếp)
            if (data.startsWith('rent_')) {
                const svcId = data.replace('rent_', '');
                const services = await mgr.getServices();
                const svc = services.find(s => s.id === svcId);
                if (!svc) {
                    await bot.answerCallbackQuery(cq.id, '❌ Dịch vụ không tồn tại!', true);
                    return res.status(200).json({ ok: true });
                }

                // 1. Kiểm tra số dư trước khi cấp số
                const user = await mgr.getUser({ id: userId });
                if (user.balance < svc.price) {
                    await bot.answerCallbackQuery(cq.id, `⚠️ Số dư không đủ! Cần ${money(svc.price)}. Bạn hiện có: ${money(user.balance)}.`, true);
                    await bot.sendMessage(
                        chatId,
                        `⚠️ <b>SỐ DƯ KHÔNG ĐỦ ĐỂ THUÊ SỐ!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                        `🏢 Dịch vụ: <b>${svc.name}</b>\n` +
                        `💰 Cước phí: <b>${money(svc.price)}</b>\n` +
                        `💰 TK Chính: <b>${Number(user.balance || 0).toLocaleString('en-US')} VNĐ</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 Vui lòng nạp thêm tiền để tiếp tục thuê số!`
                    );
                    return res.status(200).json({ ok: true });
                }

                await bot.answerCallbackQuery(cq.id, '⏳ Đang khởi tạo số...');
                const resRent = await mgr.rentService(userId, svcId);

                if (!resRent.success) {
                    if (resRent.balance !== undefined && resRent.balance < svc.price) {
                        await bot.answerCallbackQuery(cq.id, '⚠️ Số dư không đủ!', true);
                    } else {
                        await bot.answerCallbackQuery(cq.id, '❌ Không thể cấp số!', true);
                    }
                    await bot.sendMessage(chatId, `❌ <b>Không thể cấp số (${svc.name}):</b>\n\n${resRent.msg}`);
                } else {
                    const s = resRent.session;
                    const newBal = resRent.newBalance !== undefined ? resRent.newBalance : (user.balance - s.price);
                    const msg = (
                        `🎉 <b>THUÊ SỐ THÀNH CÔNG!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🏢 Dịch vụ: <b>${s.service_name}</b>\n` +
                        `📱 Số điện thoại: <code>${s.phone_number}</code> <i>(Chạm để copy)</i>\n` +
                        `💰 Cước phí: <b>${money(s.price)}</b>\n` +
                        `💰 TK Chính: <b>${Number(newBal || 0).toLocaleString('en-US')} VNĐ</b>\n` +
                        `⏱ Hạn chờ OTP: <b>10 phút</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 Hãy nhập số trên vào ứng dụng và bấm gửi mã OTP. Bot sẽ báo mã về đây ngay khi có SMS!`
                    );
                    await bot.sendMessage(chatId, msg, {
                        inline_keyboard: [
                            [{ text: '⚡ Lấy mã OTP ngay (Tức thì)', callback_data: `check_otp_${s.id}` }],
                            [{ text: '🔄 Thuê lại số này lần nữa', callback_data: `rerent_${s.phone_number}_${s.service_id}` }],
                            [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                        ]
                    });
                }
                return res.status(200).json({ ok: true });
            }

            // KIỂM TRA OTP TỨC THÌ (< 0.5s) KHI KHÁCH BẤM NÚT
            if (data.startsWith('check_otp_')) {
                const sessionId = data.replace('check_otp_', '');
                await bot.answerCallbackQuery(cq.id, '⚡ Đang quét SMS mới nhất...', false);
                const checkRes = await mgr.checkSessionOtp(sessionId);
                if (checkRes.found && checkRes.otp) {
                    await bot.answerCallbackQuery(cq.id, `🎉 Mã OTP: ${checkRes.otp}`, true);
                } else {
                    await bot.answerCallbackQuery(cq.id, '⏳ Chưa có SMS mới. Hệ thống đang tự động bắt mã mỗi 1 giây!', true);
                }
                return res.status(200).json({ ok: true });
            }

            // DANH SÁCH SỐ CŨ CỦA NGƯỜI DÙNG ĐỂ THUÊ LẠI
            if (data === 'menu_old_numbers') {
                await bot.answerCallbackQuery(cq.id);
                const oldNumbers = await mgr.getUserSuccessfulNumbers(userId);

                if (!oldNumbers.length) {
                    await bot.editMessage(chatId, messageId, 'ℹ️ Bạn chưa có số nào từng nhận OTP thành công trước đây.', {
                        inline_keyboard: [
                            [{ text: '🛒 Thuê số mới ngay', callback_data: 'menu_rent' }],
                            [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                        ]
                    });
                    return res.status(200).json({ ok: true });
                }

                const rows = oldNumbers.map(item => [
                    { text: `📱 ${item.phone_number} (${item.service_name})`, callback_data: `rerent_${item.phone_number}_${item.service_id}` }
                ]);
                rows.push([{ text: '◀️ Menu chính', callback_data: 'menu_main' }]);

                await bot.editMessage(chatId, messageId, '🔄 <b>CHỌN SỐ CŨ BẠN MUỐN THUÊ LẠI:</b>\n\n<i>Hệ thống sẽ kiểm tra xem SIM này có còn online trên modem hay không trước khi trừ tiền.</i>', { inline_keyboard: rows });
                return res.status(200).json({ ok: true });
            }

            // THỰC HIỆN THUÊ LẠI SỐ CŨ
            if (data.startsWith('rerent_')) {
                const parts = data.split('_');
                const oldPhone = parts[1];
                const svcId = parts[2];

                const services = await mgr.getServices();
                const svc = services.find(s => s.id === svcId);
                const user = await mgr.getUser({ id: userId });
                if (svc && user.balance < svc.price) {
                    await bot.answerCallbackQuery(cq.id, `⚠️ Số dư không đủ! Cần ${money(svc.price)}. Bạn hiện có: ${money(user.balance)}.`, true);
                    await bot.sendMessage(
                        chatId,
                        `⚠️ <b>SỐ DƯ KHÔNG ĐỦ!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                        `🏢 Dịch vụ: <b>${svc.name}</b>\n` +
                        `💰 Cước phí: <b>${money(svc.price)}</b>\n` +
                        `💰 TK Chính: <b>${Number(user.balance || 0).toLocaleString('en-US')} VNĐ</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 Vui lòng nạp thêm tiền để tiếp tục thuê số!`
                    );
                    return res.status(200).json({ ok: true });
                }

                await bot.answerCallbackQuery(cq.id, 'Đang kiểm tra modem SIM cũ...');
                const resReRent = await mgr.rentOldNumber(userId, oldPhone, svcId);

                if (!resReRent.success) {
                    await bot.answerCallbackQuery(cq.id, '❌ Không thể thuê lại số!', true);
                    await bot.sendMessage(chatId, `❌ <b>Không thể thuê lại số:</b>\n\n${resReRent.msg}`);
                } else {
                    const s = resReRent.session;
                    const newBal = resReRent.newBalance !== undefined ? resReRent.newBalance : (user.balance - s.price);
                    const msg = (
                        `🎉 <b>THUÊ LẠI SỐ CŨ THÀNH CÔNG!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🏢 Dịch vụ: <b>${s.service_name}</b>\n` +
                        `📱 Số điện thoại: <code>${s.phone_number}</code>\n` +
                        `💰 Cước phí: <b>${money(s.price)}</b>\n` +
                        `💰 TK Chính: <b>${Number(newBal || 0).toLocaleString('en-US')} VNĐ</b>\n` +
                        `⏱ Hạn chờ OTP: <b>10 phút</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 SIM cũ vẫn đang cắm trên modem. Hãy nhấn gửi mã xác nhận trên ứng dụng ngay!`
                    );
                    await bot.sendMessage(chatId, msg, {
                        inline_keyboard: [
                            [{ text: '⚡ Lấy mã OTP ngay (Tức thì)', callback_data: `check_otp_${s.id}` }],
                            [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                        ]
                    });
                }
                return res.status(200).json({ ok: true });
            }

            // MENU NẠP TIỀN CHECKGD USDT
            if (data === 'menu_deposit') {
                await bot.answerCallbackQuery(cq.id);
                const user = await mgr.getUser(cq.from);
                await sendDepositMenu(chatId, user, messageId);
                return res.status(200).json({ ok: true });
            }

            // CHỌN GÓI NẠP USDT CỐ ĐỊNH
            if (data.startsWith('deposit_pkg_')) {
                const amt = parseFloat(data.replace('deposit_pkg_', ''));
                await bot.answerCallbackQuery(cq.id, '⏳ Đang khởi tạo hoá đơn...');
                const user = await mgr.getUser(cq.from);
                await handleCreateDepositInvoice(chatId, user, amt);
                return res.status(200).json({ ok: true });
            }

            // NHẬP SỐ USDT TUỲ CHỌN
            if (data === 'deposit_custom') {
                await bot.answerCallbackQuery(cq.id);
                await redis.set(`otphub:state:${userId}`, 'awaiting_deposit_usdt', { ex: 300 });
                await bot.sendMessage(chatId, (
                    `✍️ <b>Nhập số USDT bạn muốn nạp:</b>\n\n` +
                    `Gửi tin nhắn số lượng USDT vào đây (Ví dụ: <code>5</code> hoặc <code>15.5</code>).\n` +
                    `<i>(Tối thiểu: 1 USDT — gõ <code>/cancel</code> để huỷ)</i>`
                ));
                return res.status(200).json({ ok: true });
            }

            // KIỂM TRA TRẠNG THÁI THANH TOÁN HOÁ ĐƠN
            if (data.startsWith('check_dep_')) {
                const transId = data.replace('check_dep_', '');
                await bot.answerCallbackQuery(cq.id, '⚡ Đang tra cứu hoá đơn CheckGD...');
                const chk = await mgr.checkCheckGdInvoice(transId);
                if (!chk.success || !chk.invoice) {
                    await bot.answerCallbackQuery(cq.id, `❌ ${chk.msg || 'Không tìm thấy hoá đơn'}`, true);
                    return res.status(200).json({ ok: true });
                }

                const inv = chk.invoice;
                if (inv.status === 'completed') {
                    const creditedKey = `otphub:credited:${inv.trans_id}`;
                    const already = await redis.get(creditedKey);
                    if (!already) {
                        const rate = Number(inv.vnd_rate) || 26000;
                        const vndAmt = Number(inv.vnd_amount) || Math.round(Number(inv.amount) * rate);
                        const newBal = await mgr.updateBalance(userId, vndAmt);
                        await redis.set(creditedKey, '1', { ex: 86400 * 30 });
                        await bot.sendMessage(chatId, 
                            `🎉 <b>NẠP TIỀN THÀNH CÔNG!</b>\n` +
                            `━━━━━━━━━━━━━━━━━━━━\n` +
                            `💵 Đã nhận: <b>+${inv.amount} USDT</b>\n` +
                            `💰 Quy đổi: <b>+${money(vndAmt)}</b>\n` +
                            `💰 TK Chính mới: <b>${Number(newBal).toLocaleString('en-US')} VNĐ</b>\n` +
                            `━━━━━━━━━━━━━━━━━━━━\n` +
                            `<i>Cảm ơn bạn đã nạp tiền!</i>`
                        );
                    }
                    await bot.answerCallbackQuery(cq.id, '🎉 Hoá đơn đã thanh toán thành công và tiền đã được cộng!', true);
                } else if (inv.status === 'waiting') {
                    await bot.answerCallbackQuery(cq.id, `⏳ Đang chờ thanh toán (${inv.amount} USDT). Quý khách vui lòng chuyển tiền hoặc mở trang Checkout!`, true);
                } else if (inv.status === 'expired') {
                    await bot.answerCallbackQuery(cq.id, '❌ Hoá đơn này đã hết hạn. Vui lòng bấm Nạp tiền để tạo hoá đơn mới!', true);
                } else {
                    await bot.answerCallbackQuery(cq.id, `Trạng thái hoá đơn: ${inv.status}`, true);
                }
                return res.status(200).json({ ok: true });
            }
        }
    } catch (err) {
        console.error('Webhook Error:', err);
        try {
            await redis.lpush('otphub:webhook_errors', JSON.stringify({
                time: new Date().toISOString(),
                error: err.message,
                stack: err.stack
            }));
            await redis.ltrim('otphub:webhook_errors', 0, 19);
        } catch (_) {}
    }

    return res.status(200).json({ ok: true });
}
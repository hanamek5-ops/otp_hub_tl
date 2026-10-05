import { TelegramBot } from '../lib/telegram.js';
import { OTPHubManager, money, formatPhoneDisplay } from '../lib/manager.js';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const mgr = new OTPHubManager(bot);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send('Bot Running');
    let update = req.body;
    if (typeof update === 'string') {
        try {
            update = JSON.parse(update);
        } catch (e) {
            console.error('Error parsing JSON body:', e);
        }
    }
    if (!update) return res.status(200).send('No update');

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

            if (text.startsWith('/start') || text.toLowerCase() === 'menu') {
                const welcomeText = (
                    `👋 <b>Xin chào, ${user.name}!</b>\n` +
                    `Chào mừng bạn đến với <b>OTP HUB GSM</b> ⚡\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `👤 ID Telegram: <code>${user.id}</code>\n` +
                    `💰 Số dư ví: <b>${money(user.balance)}</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `🔹 <i>Shopee: Tự động lọc 100% SỐ ZIN chưa đăng ký.</i>\n` +
                    `🔹 <i>Tự động hoàn tiền 100% nếu sau 10 phút không có mã OTP.</i>\n` +
                    `🔹 <i>Hỗ trợ <b>Thuê lại số cũ</b> để lấy lại tài khoản!</i>`
                );
                const kb = {
                    inline_keyboard: [
                        [{ text: '🛒 Thuê số OTP ngay', callback_data: 'menu_rent' }],
                        [{ text: '🔄 Thuê lại số cũ đã dùng', callback_data: 'menu_old_numbers' }],
                        [{ text: '💰 Kiểm tra số dư ví', callback_data: 'menu_balance' }, { text: '💬 Liên hệ hỗ trợ', callback_data: 'menu_support' }]
                    ]
                };
                await bot.sendMessage(chatId, welcomeText, kb);
                return res.status(200).json({ ok: true });
            }

            if (text === '/balance') {
                await bot.sendMessage(chatId, `💰 Số dư ví của bạn: <b>${money(user.balance)}</b>`);
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
                        [{ text: '🛒 Thuê số OTP ngay', callback_data: 'menu_rent' }],
                        [{ text: '🔄 Thuê lại số cũ đã dùng', callback_data: 'menu_old_numbers' }],
                        [{ text: '💰 Kiểm tra số dư ví', callback_data: 'menu_balance' }, { text: '💬 Liên hệ hỗ trợ', callback_data: 'menu_support' }]
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
                const contact = cfg.admin_contact || '@tralaicuocsongchochinhminh';
                const contactUrl = contact.startsWith('http') ? contact : `https://t.me/${contact.replace(/^@/, '')}`;
                await bot.editMessage(chatId, messageId, `💬 <b>HỖ TRỢ KHÁCH HÀNG:</b>\n\nAdmin: <code>${contact}</code>\nThời gian phản hồi: 24/7`, {
                    inline_keyboard: [
                        [{ text: '💬 Nhắn tin Admin', url: contactUrl }],
                        [{ text: '◀️️ Menu chính', callback_data: 'menu_main' }]
                    ]
                });
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

            // Xử lý thuê số mới
            if (data.startsWith('rent_')) {
                const svcId = data.replace('rent_', '');
                await bot.answerCallbackQuery(cq.id, 'Đang chuẩn bị số...');
                const resRent = await mgr.rentService(userId, svcId);

                if (!resRent.success) {
                    await bot.editMessage(chatId, messageId, `❌ <b>Không thể cấp số:</b>\n\n${resRent.msg}`, {
                        inline_keyboard: [[{ text: '🛒 Chọn dịch vụ khác', callback_data: 'menu_rent' }]]
                    });
                } else {
                    const s = resRent.session;
                    const msg = (
                        `🎉 <b>THUÊ SỐ THÀNH CÔNG!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🏢 Dịch vụ: <b>${s.service_name}</b>\n` +
                        `📱 Số điện thoại: <code>${s.phone_number}</code> <i>(Chạm để copy)</i>\n` +
                        `💰 Cước phí: <b>${money(s.price)}</b>\n` +
                        `⏱ Hạn chờ OTP: <b>10 phút</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 Hãy nhập số trên vào ứng dụng và bấm gửi mã OTP. Bot sẽ báo mã về đây ngay khi có SMS!`
                    );
                    await bot.editMessage(chatId, messageId, msg, {
                        inline_keyboard: [
                            [{ text: '🔄 Thuê lại số này lần nữa', callback_data: `rerent_${s.phone_number}_${s.service_id}` }],
                            [{ text: '◀️ Menu chính', callback_data: 'menu_main' }]
                        ]
                    });
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

                await bot.answerCallbackQuery(cq.id, 'Đang kiểm tra modem SIM cũ...');
                const resReRent = await mgr.rentOldNumber(userId, oldPhone, svcId);

                if (!resReRent.success) {
                    await bot.editMessage(chatId, messageId, `❌ <b>Không thể thuê lại số:</b>\n\n${resReRent.msg}`, {
                        inline_keyboard: [
                            [{ text: '🔄 Chọn số cũ khác', callback_data: 'menu_old_numbers' }],
                            [{ text: '🛒 Thuê số mới', callback_data: 'menu_rent' }]
                        ]
                    });
                } else {
                    const s = resReRent.session;
                    const msg = (
                        `🎉 <b>THUÊ LẠI SỐ CŨ THÀNH CÔNG!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `🏢 Dịch vụ: <b>${s.service_name}</b>\n` +
                        `📱 Số điện thoại: <code>${s.phone_number}</code>\n` +
                        `💰 Cước phí: <b>${money(s.price)}</b>\n` +
                        `⏱ Hạn chờ OTP: <b>10 phút</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `👉 SIM cũ vẫn đang cắm trên modem. Hãy nhấn gửi mã xác nhận trên ứng dụng ngay!`
                    );
                    await bot.editMessage(chatId, messageId, msg, {
                        inline_keyboard: [[{ text: '◀️ Menu chính', callback_data: 'menu_main' }]]
                    });
                }
                return res.status(200).json({ ok: true });
            }
        }
    } catch (err) {
        console.error('Webhook Error:', err);
    }

    return res.status(200).json({ ok: true });
}
import { redis, KEYS } from './redis.js';
import crypto from 'crypto';

export const BASE_SERVICES = [
    { id: 'shopee', name: 'Shopee / ShopeePay', price: 5000, pattern: 'shopee|shopeepay', icon: '🛍️', shopee_check: true },
    { id: 'google', name: 'Gmail / Google', price: 3400, pattern: 'google|gmail|g-\\d{4,8}', icon: '📧' },
    { id: 'microsoft', name: 'Hotmail / Outlook / Azure', price: 3000, pattern: 'microsoft|msft|azure|outlook|hotmail', icon: '📨' },
    { id: 'grab', name: 'Grab (Bike/Car/Food)', price: 3000, pattern: 'grab', icon: '🚗' },
    { id: 'be', name: 'Be (BeGroup)', price: 3000, pattern: '\\bbe\\b|begroup|be\\s*group|be\\s*vietnam|be\\s*driver', icon: '🚕' },
    { id: 'tiktok', name: 'TikTok / Douyin', price: 3900, pattern: 'tiktok|tik\\s*tok|bytedance|douyin', icon: '🎵' },
    { id: 'telegram', name: 'Telegram', price: 13000, pattern: 'telegram|\\btg\\b', icon: '✈️' },
    { id: 'facebook', name: 'Facebook / Meta', price: 3000, pattern: 'facebook|\\bfb\\b|meta', icon: '👥' },
    { id: 'zalo', name: 'Zalo', price: 3000, pattern: 'zalo|vng', icon: '💬' },
    { id: 'lazada', name: 'Lazada', price: 3900, pattern: 'lazada', icon: '📦' },
    { id: 'shopeefood', name: 'ShopeeFood (Now)', price: 5000, pattern: 'shopeefood|\\bnow\\b|foody', icon: '🍔' },
    { id: 'momo', name: 'MoMo', price: 3000, pattern: 'momo|m_service', icon: '👛' },
    { id: 'gojek', name: 'Gojek', price: 3000, pattern: 'gojek|goviet|go-viet|go\\s*jek', icon: '🛵' },
    { id: 'instagram', name: 'Instagram', price: 3400, pattern: 'instagram|\\big\\b', icon: '📷' },
    { id: 'tiki', name: 'Tiki', price: 3000, pattern: 'tiki', icon: '🛒' },
    { id: 'other', name: 'Tất cả dịch vụ (Bất kỳ OTP nào)', price: 3000, pattern: null, icon: '⚡' }
];

export function money(n) {
    return `${Number(n || 0).toLocaleString('vi-VN')} đ`;
}

export function cleanPhone(phone) {
    return String(phone || '').replace(/\D/g, '').replace(/^(84|0)/, '');
}

export function formatPhoneDisplay(phone) {
    let p = String(phone || '').replace(/\D/g, '');
    if (p.startsWith('840') && p.length >= 12) p = '0' + p.slice(3);
    else if (p.startsWith('84') && p.length >= 11) p = '0' + p.slice(2);
    else if (!p.startsWith('0') && p.length === 9) p = '0' + p;
    return p;
}

export class OTPHubManager {
    constructor(bot) {
        this.bot = bot;
    }

    async getConfig() {
        let cfg = null;
        try {
            cfg = await redis.get(KEYS.CONFIG);
        } catch (_) {}

        if (!cfg) {
            cfg = {
                gsm_url: process.env.GSM_URL || '',
                otistx_api_key: process.env.OTIS_API_KEY || '',
                checkgd_api_key: process.env.CHECKGD_API_KEY || '',
                admin_contact: process.env.ADMIN_CONTACT || '@tralaicuocsongchochinhminh',
                payments_enabled: process.env.PAYMENTS_ENABLED === 'true',
                admin_ids: (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
                prices: {},
                custom_services: [],
                disabled_services: []
            };
            try {
                await redis.set(KEYS.CONFIG, cfg);
            } catch (e) {
                console.error('[Redis set config error]:', e.message);
            }
        }
        return cfg;
    }

    async getServices() {
        const cfg = await this.getConfig();
        const disabled = new Set(cfg.disabled_services || []);
        let list = BASE_SERVICES.map(s => ({
            ...s,
            price: cfg.prices?.[s.id] || s.price,
            enabled: !disabled.has(s.id)
        }));

        for (const c of (cfg.custom_services || [])) {
            if (!list.some(x => x.id === c.id)) {
                list.push({
                    ...c,
                    price: cfg.prices?.[c.id] || c.price,
                    enabled: !disabled.has(c.id)
                });
            }
        }
        return list;
    }

    async getUser(fromUser) {
        const uid = String(fromUser.id);
        let user = null;
        try {
            user = await redis.hget(KEYS.USERS, uid);
        } catch (e) {
            console.error('[Redis getUser hget error]:', e.message);
        }

        if (!user) {
            const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || 'Khách hàng';
            user = {
                id: uid,
                name: fullName,
                username: fromUser.username || '',
                balance: 0,
                created_at: new Date().toISOString()
            };
            try {
                await redis.hset(KEYS.USERS, { [uid]: user });
            } catch (e) {
                console.error('[Redis getUser hset error - Check UPSTASH Token Write Permission]:', e.message);
            }
        }
        return user;
    }

    async updateBalance(userIdOrUsername, delta) {
        const search = String(userIdOrUsername).trim().replace(/^@/, '').toLowerCase();
        const allUsers = (await redis.hgetall(KEYS.USERS)) || {};
        let target = null;

        if (allUsers[search]) {
            target = allUsers[search];
        } else {
            for (const u of Object.values(allUsers)) {
                if (u.username?.toLowerCase() === search) {
                    target = u;
                    break;
                }
            }
        }

        if (!target && /^\d+$/.test(search)) {
            target = {
                id: search,
                name: `Khách hàng ${search.slice(-4)}`,
                username: '',
                balance: 0,
                created_at: new Date().toISOString()
            };
        }

        if (target) {
            if ((target.balance + delta) < 0) throw new Error('Số dư không được làm âm');
            target.balance += delta;
            await redis.hset(KEYS.USERS, { [target.id]: target });
            return target.balance;
        }
        return null;
    }

    async isAdmin(userId) {
        const cfg = await this.getConfig();
        const envAdmins = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
        const configAdmins = cfg.admin_ids || [];
        const allAdmins = Array.from(new Set([...envAdmins, ...configAdmins]));
        return allAdmins.includes(String(userId));
    }

    async fetchGsmModems() {
        const cfg = await this.getConfig();
        if (!cfg.gsm_url) return [];
        try {
            const u = new URL(cfg.gsm_url);
            const token = u.pathname.replace(/\/+$/, '').split('/').pop();
            if (!token) return [];
            const res = await fetch(`https://gsmonline.net/api/public/${token}/agents`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const data = await res.json();
            const modems = [];
            for (const agent of data.agents || []) {
                for (const m of agent.modems || []) {
                    if (m.phone_number && m.connected !== false) {
                        modems.push({
                            phone_number: formatPhoneDisplay(m.phone_number),
                            port: m.port || 'Cổng SIM',
                            operator: m.operator || 'SIM'
                        });
                    }
                }
            }
            return modems;
        } catch {
            return [];
        }
    }

    async getAvailableNumbers(serviceId) {
        const modems = await this.fetchGsmModems();
        const candidates = modems.map(m => m.phone_number);
        if (!candidates.length) return [];

        const now = Date.now();
        const sessions = (await redis.lrange(KEYS.SESSIONS, 0, 500)) || [];
        const usedMap = (await redis.get(KEYS.USED_SERVICES)) || {};

        const busy = new Set();
        for (const s of sessions) {
            const p = formatPhoneDisplay(s.phone_number);
            if (s.status === 'waiting' || (s.status === 'success' && now < s.end_time)) busy.add(p);
            else if (now < (s.cooldown || 0)) busy.add(p);
        }

        const usedForService = new Set();
        if (serviceId && serviceId !== 'other') {
            for (const [phone, svcs] of Object.entries(usedMap)) {
                if ((svcs || []).includes(serviceId)) usedForService.add(formatPhoneDisplay(phone));
            }
        }

        return candidates.filter(n => {
            const p = formatPhoneDisplay(n);
            if (busy.has(p)) return false;
            if (serviceId && serviceId !== 'other' && usedForService.has(p)) return false;
            return true;
        }).sort(() => 0.5 - Math.random());
    }

    async checkOtistxShopeeBulk(phoneNumbers) {
        const cfg = await this.getConfig();
        if (!phoneNumbers?.length || !cfg.otistx_api_key) return [];
        try {
            const res = await fetch('https://otistx.com/api/phone-checks/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.otistx_api_key },
                body: JSON.stringify({ phoneNumbers })
            });
            const data = await res.json();
            return data.results || [];
        } catch {
            return [];
        }
    }

    // Thuê số mới (lọc số trùng theo dịch vụ)
    async rentService(userId, serviceId) {
        const services = await this.getServices();
        const svc = services.find(s => s.id === serviceId);
        if (!svc || !svc.enabled) return { success: false, msg: 'Dịch vụ không tồn tại hoặc tạm ngưng.' };

        const user = await this.getUser({ id: userId });
        if (user.balance < svc.price) {
            return { success: false, msg: `Số dư không đủ! Cần <b>${money(svc.price)}</b>. Bạn hiện có: <b>${money(user.balance)}</b>.` };
        }

        const available = await this.getAvailableNumbers(serviceId);
        if (!available.length) {
            return { success: false, msg: `Hiện tại tất cả SIM cho dịch vụ <b>${svc.name}</b> đang bận hoặc đã hết số mới. Vui lòng thử lại sau!` };
        }

        let chosen = null;
        if (svc.shopee_check || serviceId === 'shopee') {
            const batch = available.slice(0, 15);
            const results = await this.checkOtistxShopeeBulk(batch);
            const cleanOnes = results.filter(r => r.isRegistered === false).map(r => r.phoneNumber);
            if (cleanOnes.length) chosen = cleanOnes[0];
            if (!chosen) return { success: false, msg: 'Chưa lọc được số chưa đăng ký Shopee lúc này. Hãy thử lại sau vài giây!' };
        } else {
            chosen = available[0];
        }

        user.balance -= svc.price;
        await redis.hset(KEYS.USERS, { [user.id]: user });

        const now = Date.now();
        const session = {
            id: 'SES' + crypto.randomUUID().replace(/-/g, ''),
            user_id: String(userId),
            service_id: svc.id,
            service_name: svc.name,
            service_pattern: svc.pattern,
            phone_number: formatPhoneDisplay(chosen),
            price: svc.price,
            start_time: now,
            end_time: now + 600 * 1000, // 10 phút
            status: 'waiting',
            otp: null,
            sms_text: null,
            is_re_rent: false
        };

        await redis.lpush(KEYS.SESSIONS, session);
        return { success: true, session };
    }

    // TÍNH NĂNG: Thuê lại đúng số cũ đã từng nhận OTP thành công
    async rentOldNumber(userId, oldPhoneNumber, serviceId) {
        const services = await this.getServices();
        const svc = services.find(s => s.id === serviceId);
        if (!svc || !svc.enabled) return { success: false, msg: 'Dịch vụ không tồn tại hoặc đã bị tắt.' };

        const user = await this.getUser({ id: userId });
        if (user.balance < svc.price) {
            return { success: false, msg: `Số dư không đủ! Cần <b>${money(svc.price)}</b> để thuê lại số này.` };
        }

        const cleanTarget = cleanPhone(oldPhoneNumber);
        const modems = await this.fetchGsmModems();
        const isOnline = modems.some(m => cleanPhone(m.phone_number) === cleanTarget);

        if (!isOnline) {
            return { success: false, msg: `SIM <code>${formatPhoneDisplay(oldPhoneNumber)}</code> hiện <b>KHÔNG ONLINE</b> trên modem GSM (đã bị rút hoặc mất sóng). Không thể thuê lại số này!` };
        }

        const now = Date.now();
        const sessions = (await redis.lrange(KEYS.SESSIONS, 0, 500)) || [];
        const isBusy = sessions.some(s => cleanPhone(s.phone_number) === cleanTarget && (s.status === 'waiting' || (s.status === 'success' && now < s.end_time)));

        if (isBusy) {
            return { success: false, msg: `Số <code>${formatPhoneDisplay(oldPhoneNumber)}</code> hiện <b>ĐANG CÓ PHIÊN THUÊ CHỜ OTP</b> khác. Vui lòng đợi phiên đó kết thúc!` };
        }

        user.balance -= svc.price;
        await redis.hset(KEYS.USERS, { [user.id]: user });

        const session = {
            id: 'SES' + crypto.randomUUID().replace(/-/g, ''),
            user_id: String(userId),
            service_id: svc.id,
            service_name: svc.name,
            service_pattern: svc.pattern,
            phone_number: formatPhoneDisplay(oldPhoneNumber),
            price: svc.price,
            start_time: now,
            end_time: now + 600 * 1000,
            status: 'waiting',
            otp: null,
            sms_text: null,
            is_re_rent: true
        };

        await redis.lpush(KEYS.SESSIONS, session);
        return { success: true, session };
    }

    // Danh sách các số cũ user này đã từng thuê thành công
    async getUserSuccessfulNumbers(userId) {
        const sessions = (await redis.lrange(KEYS.SESSIONS, 0, 1000)) || [];
        const map = new Map();

        for (const s of sessions) {
            if (String(s.user_id) === String(userId) && s.status === 'success' && s.phone_number) {
                const p = formatPhoneDisplay(s.phone_number);
                if (!map.has(p)) {
                    map.set(p, {
                        phone_number: p,
                        service_id: s.service_id,
                        service_name: s.service_name,
                        last_received: s.received_at || s.start_time
                    });
                }
            }
        }
        return Array.from(map.values()).slice(0, 15);
    }

    extractOtp(rawOtp, text) {
        if (rawOtp && /^\d{4,8}$/.test(String(rawOtp).trim())) return String(rawOtp).trim();
        const t = String(text || '');
        let m = t.match(/(?:otp|xác\s*minh|xac\s*minh|xác\s*thực|code|mã|g-)[^\d]{0,25}(\d{4,8})(?!\d)/i);
        if (m) return m[1];
        m = t.match(/(\d{4,8})[^\d]{1,25}(?:là\s*mã|otp|code)/i);
        if (m) return m[1];
        m = t.match(/\b\d{4,8}\b/);
        return m ? m[0] : null;
    }

    // Quét SMS từ GSM & Tự động hoàn tiền
    async pollMessages() {
        const cfg = await this.getConfig();
        const sessions = (await redis.lrange(KEYS.SESSIONS, 0, 100)) || [];
        const now = Date.now();
        let updatedSessions = false;

        const waiting = sessions.filter(s => s.status === 'waiting');
        if (!waiting.length) return;

        // 1. Kiểm tra hết hạn 10 phút -> Hoàn tiền
        for (const s of waiting) {
            if (now >= s.end_time) {
                s.status = 'refunded';
                await this.updateBalance(s.user_id, s.price);
                await this.bot.sendMessage(
                    s.user_id,
                    `⏰ <b>HẾT THỜI GIAN CHỜ OTP (10 PHÚT) - TỰ ĐỘNG HOÀN TIỀN</b>\n━━━━━━━━━━━━━━━━━━━━\n📱 Số điện thoại: <code>${s.phone_number}</code>\n🏢 Dịch vụ: <b>${s.service_name}</b>\n💰 Đã hoàn: <b>+${money(s.price)}</b> vào ví của bạn!\n━━━━━━━━━━━━━━━━━━━━\n<i>Hệ thống cam kết 100% không trừ tiền nếu không có OTP.</i>`
                );
                updatedSessions = true;
            }
        }

        if (!cfg.gsm_url) return;
        const u = new URL(cfg.gsm_url);
        const token = u.pathname.replace(/\/+$/, '').split('/').pop();
        const res = await fetch(`https://gsmonline.net/api/public/${token}/messages?limit=100&offset=0`);
        const { messages = [] } = await res.json();

        const usedMap = (await redis.get(KEYS.USED_SERVICES)) || {};

        // 2. So khớp SMS với đơn đang chờ
        for (const s of waiting.filter(x => x.status === 'waiting')) {
            const cleanP = cleanPhone(s.phone_number);
            const reg = s.service_pattern ? new RegExp(s.service_pattern, 'i') : null;

            for (const m of messages) {
                if (cleanPhone(m.recipient) !== cleanP) continue;
                const recTs = Number(m.received_at) > 1e12 ? Number(m.received_at) : Number(m.received_at) * 1000;
                if (recTs < s.start_time || recTs > s.end_time) continue;

                const fullTxt = `${m.sender || ''} ${m.text || ''}`;
                if (s.service_id === 'shopee' && /shopee\s*food|foody|\bnow\b/i.test(fullTxt)) continue;
                if (reg && !reg.test(fullTxt)) continue;

                const otp = this.extractOtp(m.otp, m.text);
                if (!otp) continue;

                s.status = 'success';
                s.otp = otp;
                s.sms_text = m.text;
                s.received_at = recTs;
                s.cooldown = now + 60 * 1000;
                updatedSessions = true;

                if (s.service_id !== 'other') {
                    const pKey = formatPhoneDisplay(s.phone_number);
                    usedMap[pKey] = usedMap[pKey] || [];
                    if (!usedMap[pKey].includes(s.service_id)) usedMap[pKey].push(s.service_id);
                }

                const msgText = (
                    `🎉🎉 <b>BẠN ĐÃ NHẬN ĐƯỢC MÃ OTP!</b> 🎉🎉\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📱 Số điện thoại: <code>${s.phone_number}</code>\n` +
                    `🔑 Mã OTP: <code>${otp}</code> <i>(Chạm để copy)</i>\n` +
                    `🏢 Dịch vụ: <b>${s.service_name}</b>\n` +
                    `📩 SMS: <i>"${m.text || ''}"</i>\n` +
                    `━━━━━━━━━━━━━━━━━━━━`
                );
                const replyMarkup = {
                    inline_keyboard: [
                        [{ text: '🔄 Thuê lại số này', callback_data: `rerent_${s.phone_number}_${s.service_id}` }],
                        [{ text: '🛒 Thuê số khác', callback_data: 'menu_rent' }]
                    ]
                };
                await this.bot.sendMessage(s.user_id, msgText, replyMarkup);
                break;
            }
        }

        if (updatedSessions) {
            await redis.del(KEYS.SESSIONS);
            if (sessions.length) await redis.rpush(KEYS.SESSIONS, ...sessions);
            await redis.set(KEYS.USED_SERVICES, usedMap);
        }
    }
}
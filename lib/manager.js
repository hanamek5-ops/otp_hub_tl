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
        } catch (_) { }

        if (!cfg) {
            cfg = {
                gsm_url: process.env.GSM_URL || '',
                otistx_api_key: process.env.OTIS_API_KEY || '',
                checkgd_api_key: process.env.CHECKGD_API_KEY || '',
                admin_contact: process.env.ADMIN_CONTACT || '',
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
        const deleted = new Set(cfg.deleted_services || []);
        const overrides = cfg.service_overrides || {};

        let list = BASE_SERVICES
            .filter(s => !deleted.has(s.id))
            .map(s => {
                const ov = overrides[s.id] || {};
                return {
                    ...s,
                    name: ov.name || s.name,
                    icon: ov.icon || s.icon,
                    pattern: ov.pattern !== undefined ? ov.pattern : s.pattern,
                    price: cfg.prices?.[s.id] ?? ov.price ?? s.price,
                    enabled: !disabled.has(s.id),
                    is_custom: false
                };
            });

        for (const c of (cfg.custom_services || [])) {
            if (deleted.has(c.id)) continue;
            const ov = overrides[c.id] || {};
            if (!list.some(x => x.id === c.id)) {
                list.push({
                    ...c,
                    name: ov.name || c.name,
                    icon: ov.icon || c.icon,
                    pattern: ov.pattern !== undefined ? ov.pattern : c.pattern,
                    price: cfg.prices?.[c.id] ?? ov.price ?? c.price,
                    enabled: !disabled.has(c.id),
                    is_custom: true
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
            const apiKey = crypto.randomBytes(16).toString('hex');
            user = {
                id: uid,
                name: fullName,
                username: fromUser.username || '',
                balance: 0,
                api_key: apiKey,
                created_at: new Date().toISOString()
            };
            try {
                await redis.hset(KEYS.USERS, { [uid]: user });
                await redis.hset(KEYS.API_KEYS, { [apiKey]: uid });
            } catch (e) {
                console.error('[Redis getUser hset error - Check UPSTASH Token Write Permission]:', e.message);
            }
        } else if (!user.api_key) {
            user.api_key = crypto.randomBytes(16).toString('hex');
            try {
                await redis.hset(KEYS.USERS, { [uid]: user });
                await redis.hset(KEYS.API_KEYS, { [user.api_key]: uid });
            } catch (e) {
                console.error('[Redis getUser update api_key error]:', e.message);
            }
        }
        return user;
    }

    async getUserByApiKey(token) {
        if (!token) return null;
        const cleanToken = String(token).trim();
        if (!cleanToken) return null;

        let uid = null;
        try {
            uid = await redis.hget(KEYS.API_KEYS, cleanToken);
        } catch (_) { }

        if (uid) {
            const user = await redis.hget(KEYS.USERS, String(uid));
            if (user) return user;
        }

        // Fallback: Tìm trong toàn bộ users nếu index chưa sync
        const allUsers = (await redis.hgetall(KEYS.USERS)) || {};
        for (const u of Object.values(allUsers)) {
            if (u && u.api_key === cleanToken) {
                try {
                    await redis.hset(KEYS.API_KEYS, { [cleanToken]: u.id });
                } catch (_) { }
                return u;
            }
        }
        return null;
    }

    async generateNewApiKey(userId) {
        const uid = String(userId);
        let user = await redis.hget(KEYS.USERS, uid);
        if (!user) {
            const allUsers = (await redis.hgetall(KEYS.USERS)) || {};
            user = Object.values(allUsers).find(u => String(u.id) === uid);
        }
        if (!user) throw new Error('Không tìm thấy người dùng');

        const oldKey = user.api_key;
        if (oldKey) {
            try {
                await redis.hdel(KEYS.API_KEYS, oldKey);
            } catch (_) { }
        }

        const newKey = crypto.randomBytes(16).toString('hex');
        user.api_key = newKey;
        await redis.hset(KEYS.USERS, { [user.id]: user });
        await redis.hset(KEYS.API_KEYS, { [newKey]: user.id });
        return newKey;
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
            const newApiKey = crypto.randomBytes(16).toString('hex');
            target = {
                id: search,
                name: `Khách hàng ${search.slice(-4)}`,
                username: '',
                balance: 0,
                api_key: newApiKey,
                created_at: new Date().toISOString()
            };
            try {
                await redis.hset(KEYS.API_KEYS, { [newApiKey]: search });
            } catch (_) { }
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
        const sessions = (await redis.lrange(KEYS.SESSIONS, 0, 1000)) || [];
        const usedMap = (await redis.get(KEYS.USED_SERVICES)) || {};

        // 1. RÀNG BUỘC SỐ BẬN (busy): Đang có khách thuê chờ OTP hoặc đang cooldown
        // -> Tuyệt đối không cấp cho BẤT KỲ khách nào và BẤT KỲ dịch vụ nào trong lúc này
        const busy = new Set();
        for (const s of sessions) {
            const p = cleanPhone(s.phone_number);
            if (!p) continue;
            if (s.status === 'waiting' || (s.status === 'success' && now < s.end_time)) busy.add(p);
            else if (now < (s.cooldown || 0)) busy.add(p);
        }

        // 2. RÀNG BUỘC THEO TỪNG DỊCH VỤ (usedForService):
        // Số đã từng nhận OTP thành công cho dịch vụ này -> Khách sau thuê dịch vụ này TUYỆT ĐỐI KHÔNG ĐƯỢC TRÙNG.
        // Nhưng khách thuê dịch vụ KHÁC thì VẪN CẤP ĐƯỢC số này (nếu không bận).
        const usedForService = new Set();
        if (serviceId && serviceId !== 'other') {
            // Kiểm tra từ usedMap
            for (const [phone, svcs] of Object.entries(usedMap)) {
                const cleanP = cleanPhone(phone);
                if (!cleanP) continue;
                const list = Array.isArray(svcs) ? svcs : [];
                if (list.includes(serviceId)) {
                    usedForService.add(cleanP);
                }
            }

            // Quét thêm qua toàn bộ lịch sử sessions thành công để chống lọt 100%
            for (const s of sessions) {
                if (s.status === 'success' && s.service_id === serviceId) {
                    const cleanP = cleanPhone(s.phone_number);
                    if (cleanP) usedForService.add(cleanP);
                }
            }
        }

        return candidates.filter(n => {
            const p = cleanPhone(n);
            if (!p) return false;
            if (busy.has(p)) return false; // Không cấp số đang bận chờ OTP
            if (usedForService.has(p)) return false; // Không cấp trùng số cho cùng dịch vụ đã ra OTP
            return true;
        }).sort(() => 0.5 - Math.random());
    }

    // Kiểm tra số điện thoại chưa đăng ký Shopee qua OtisTx API (Hỗ trợ batching & cache)
    async checkOtistxShopeeBulk(phoneNumbers) {
        if (!phoneNumbers?.length) return [];
        const cfg = await this.getConfig();
        const apiKey = (cfg.otistx_api_key || process.env.OTIS_API_KEY || '').trim();
        if (!apiKey) return [];

        const allResults = [];
        const batchSize = 50;

        for (let i = 0; i < phoneNumbers.length; i += batchSize) {
            const batch = phoneNumbers.slice(i, i + batchSize);
            try {
                const formattedList = batch.map(p => formatPhoneDisplay(p));
                const res = await fetch('https://otistx.com/api/phone-checks/bulk', {
                    method: 'POST',
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        'Content-Type': 'application/json',
                        'X-Api-Key': apiKey
                    },
                    body: JSON.stringify({ phoneNumbers: formattedList })
                });
                const resp = await res.json();
                const results = resp.results || [];
                allResults.push(...results);

                // Cập nhật cache vào Redis
                const cacheMap = {};
                for (const r of results) {
                    const p = r.phoneNumber || '';
                    for (const orig of batch) {
                        if (cleanPhone(orig) === cleanPhone(p)) {
                            cacheMap[formatPhoneDisplay(orig)] = {
                                is_registered: r.isRegistered,
                                checked_at: Date.now(),
                                cost: r.cost || 0
                            };
                        }
                    }
                }
                if (Object.keys(cacheMap).length) {
                    await redis.hset(KEYS.SHOPEE_CACHE, cacheMap);
                }
            } catch (e) {
                console.error(`[Otistx Error for batch ${i}-${i + batch.length}]:`, e.message);
            }
        }

        return allResults;
    }

    // Quét toàn bộ SIM modem để lọc danh sách số zin Shopee
    async checkShopeeAllModems() {
        const modems = await this.fetchGsmModems();
        const phones = modems.map(m => m.phone_number);
        if (!phones.length) return { unreg: [], reg: [] };
        const results = await this.checkOtistxShopeeBulk(phones);
        const unreg = results.filter(r => r.isRegistered === false).map(r => r.phoneNumber);
        const reg = results.filter(r => r.isRegistered === true).map(r => r.phoneNumber);
        return { unreg, reg };
    }

    // Thuê số mới (lọc số trùng trên từng user & kiểm tra Shopee qua OtisTx nếu có key)
    async rentService(userId, serviceId) {
        const services = await this.getServices();
        const svc = services.find(s => s.id === serviceId);
        if (!svc || !svc.enabled) return { success: false, msg: 'Dịch vụ không tồn tại hoặc tạm ngưng.' };

        const user = await this.getUser({ id: userId });
        if (user.balance < svc.price) {
            return { success: false, msg: `Số dư không đủ! Cần <b>${money(svc.price)}</b>. Bạn hiện có: <b>${money(user.balance)}</b>.` };
        }

        const available = await this.getAvailableNumbers(svc.id);
        if (!available.length) {
            return { success: false, msg: `Hiện tại tất cả SIM cho dịch vụ <b>${svc.name}</b> đều đang bận hoặc đã hết số mới. Vui lòng thử lại sau hoặc chọn dịch vụ khác!` };
        }

        let chosen = null;
        const cfg = await this.getConfig();
        const apiKey = (cfg.otistx_api_key || process.env.OTIS_API_KEY || '').trim();

        // NẾU LÀ SHOPEE -> BẮT BUỘC CHECK OTISTX ĐỂ LẤY SỐ CHƯA ĐĂNG KÝ
        if (svc.shopee_check || serviceId === 'shopee') {
            if (!apiKey) {
                return {
                    success: false,
                    msg: '⚠️ Hệ thống chưa được cấu hình <b>OtisTx API Key</b> để kiểm tra số zin Shopee. Vui lòng cấu hình trong Cài đặt Hệ thống hoặc liên hệ Admin!'
                };
            }

            // 1. Tìm tất cả số sạch trong cache từ danh sách available (đã shuffle)
            let cleanInCache = [];
            let shopeeCache = {};
            try {
                shopeeCache = (await redis.hgetall(KEYS.SHOPEE_CACHE)) || {};
            } catch (_) { }

            const ttl = (cfg.shopee_cache_ttl || 60) * 1000;
            const nowTs = Date.now();

            for (const num of available) {
                const c = shopeeCache[formatPhoneDisplay(num)] || shopeeCache[cleanPhone(num)];
                if (c && c.is_registered === false && (nowTs - (c.checked_at || 0) < ttl)) {
                    cleanInCache.push(num);
                }
            }

            if (cleanInCache.length) {
                chosen = cleanInCache[Math.floor(Math.random() * cleanInCache.length)];
            }

            // 2. Nếu chưa có số sạch trong cache: Quét theo từng nhóm nhỏ (15 số/nhóm)
            // Dừng ngay khi tìm được số chưa đăng ký để khách nhận số tức thì và tiết kiệm chi phí!
            if (!chosen) {
                const cachedKeys = new Set(Object.keys(shopeeCache));
                let candidates = available.filter(num => !cachedKeys.has(formatPhoneDisplay(num)) && !cachedKeys.has(cleanPhone(num)));
                if (!candidates.length) {
                    candidates = [...available];
                }
                candidates.sort(() => 0.5 - Math.random());

                const batchSize = 15;
                for (let i = 0; i < candidates.length; i += batchSize) {
                    const batch = candidates.slice(i, i + batchSize);
                    const results = await this.checkOtistxShopeeBulk(batch);
                    const unregInBatch = [];
                    for (const res of results) {
                        if (res.isRegistered === false) {
                            for (const orig of batch) {
                                if (cleanPhone(orig) === cleanPhone(res.phoneNumber)) {
                                    unregInBatch.push(orig);
                                }
                            }
                        }
                    }
                    if (unregInBatch.length) {
                        chosen = unregInBatch[Math.floor(Math.random() * unregInBatch.length)];
                        break;
                    }
                }
            }

            if (!chosen) {
                return {
                    success: false,
                    msg: 'Chưa xác nhận được số chưa đăng ký Shopee. Có thể nguồn số hoặc API kiểm tra đang lỗi; không trừ tiền của bạn.'
                };
            }
        } else {
            chosen = available[Math.floor(Math.random() * available.length)] || available[0];
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
            created_at: new Date(now).toISOString(),
            end_time: now + 600 * 1000, // 10 phút
            status: 'waiting',
            otp: null,
            otp_code: null,
            sms_text: null,
            is_re_rent: false
        };

        await redis.lpush(KEYS.SESSIONS, session);
        return { success: true, session, newBalance: user.balance, balance: user.balance };
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
            created_at: new Date(now).toISOString(),
            end_time: now + 600 * 1000, // 10 phút
            status: 'waiting',
            otp: null,
            otp_code: null,
            sms_text: null,
            is_re_rent: true
        };

        await redis.lpush(KEYS.SESSIONS, session);
        return { success: true, session, newBalance: user.balance, balance: user.balance };
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
                const newBal = await this.updateBalance(s.user_id, s.price);
                const svcName = s.service_name ? s.service_name.split('/')[0].trim() : 'dịch vụ';
                const refundMsg = (
                    `⏰ <b>Hết thời gian chờ OTP!</b>\n\n` +
                    `📞 SĐT: <code>${s.phone_number}</code>\n` +
                    `Đã chờ quá 10 phút mà không nhận được mã OTP ${svcName}. Em đã tự huỷ yêu cầu.\n\n` +
                    `♻️ Thất bại: Hoàn lại ${Number(s.price || 0).toLocaleString('en-US')} VNĐ vào TK.\n` +
                    `💰 TK Chính: ${Number(newBal || 0).toLocaleString('en-US')} VNĐ`
                );
                await this.bot.sendMessage(s.user_id, refundMsg);
                updatedSessions = true;
            }
        }

        if (!cfg.gsm_url) return waiting.length;
        const u = new URL(cfg.gsm_url);
        const token = u.pathname.replace(/\/+$/, '').split('/').pop();
        const res = await fetch(`https://gsmonline.net/api/public/${token}/messages?limit=35&offset=0`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            cache: 'no-store'
        });
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
                s.otp_code = otp;
                s.sms_text = m.text;
                s.received_at = recTs;
                s.cooldown = now + 60 * 1000;
                updatedSessions = true;

                if (s.service_id) {
                    const pKey = cleanPhone(s.phone_number);
                    usedMap[pKey] = usedMap[pKey] || [];
                    if (!usedMap[pKey].includes(s.service_id)) usedMap[pKey].push(s.service_id);
                }

                const msgText = (
                    `⚡ <b>BẠN ĐÃ NHẬN ĐƯỢC MÃ OTP SIÊU TỐC!</b> ⚡\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📱 Số điện thoại: <code>${s.phone_number}</code>\n` +
                    `🔑 Mã OTP: <code>${otp}</code> <i>(Chạm để copy)</i>\n` +
                    `🏢 Dịch vụ: <b>${s.service_name}</b>\n` +
                    `📩 Tin nhắn SMS: <i>"${m.text || ''}"</i>\n` +
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

        return waiting.filter(x => x.status === 'waiting').length;
    }

    // Kiểm tra trực tiếp OTP tức thì cho 1 đơn cụ thể
    async checkSessionOtp(sessionId) {
        const sessions = (await redis.lrange(KEYS.SESSIONS, 0, 100)) || [];
        const s = sessions.find(item => item.id === sessionId);
        if (!s) return { found: false, msg: 'Không tìm thấy đơn thuê' };
        if (s.status === 'success' && (s.otp || s.otp_code)) {
            return { found: true, otp: s.otp || s.otp_code, text: s.sms_text, session: s };
        }
        // Gọi poll tức thì một lần để kiểm tra SMS mới nhất
        await this.pollMessages();
        const updated = (await redis.lrange(KEYS.SESSIONS, 0, 100)) || [];
        const fresh = updated.find(item => item.id === sessionId);
        if (fresh && fresh.status === 'success' && (fresh.otp || fresh.otp_code)) {
            return { found: true, otp: fresh.otp || fresh.otp_code, text: fresh.sms_text, session: fresh };
        }
        return { found: false, session: fresh || s };
    }

    // CHECKGD: Lấy API Key CheckGD
    async getCheckGdApiKey() {
        const cfg = await this.getConfig();
        return (cfg.checkgd_api_key || process.env.CHECKGD_API_KEY || 'pk_99c95af11d1ccb840f2164dedaa44bda9c947bb6b20ae60a').trim();
    }

    // CHECKGD: Lấy tỉ giá USDT/VND realtime
    async getExchangeRate() {
        try {
            const res = await fetch('https://checkgd.vn/api/exchange-rate', { cache: 'no-store' });
            const data = await res.json();
            if (data?.success && data?.data?.rate) {
                return Number(data.data.rate);
            }
        } catch (e) {
            console.error('[CheckGD Exchange Rate Error]:', e.message);
        }
        return 26030;
    }

    // CHECKGD: Tạo hoá đơn nạp USDT
    async createCheckGdInvoice({ userId, amountUsdt, network = 'TRC20', callbackUrl = null }) {
        const apiKey = await this.getCheckGdApiKey();
        if (!apiKey) {
            return { success: false, msg: 'Chưa cấu hình CheckGD API Key' };
        }
        const requestId = `DEP_${userId}_${Date.now()}`;
        const cbUrl = callbackUrl || process.env.CHECKGD_CALLBACK_URL || 'https://otphubtl.vercel.app/api/checkgd-webhook';

        try {
            const res = await fetch('https://checkgd.vn/api/v1/invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: apiKey,
                    amount: Number(amountUsdt),
                    type: network,
                    request_id: requestId,
                    callback_url: cbUrl,
                    merchant_id: String(userId),
                    expiry_minutes: 60
                })
            });
            const data = await res.json();
            if (!data.success || !data.data?.trans_id) {
                return { success: false, msg: data.msg || data.error?.message || 'Không thể tạo hoá đơn' };
            }

            const invoice = data.data;
            try {
                const detailRes = await fetch(`https://checkgd.vn/api/v1/invoices/${invoice.trans_id}`);
                const detailData = await detailRes.json();
                if (detailData.success && detailData.data) {
                    Object.assign(invoice, detailData.data);
                }
            } catch (_) {}

            try {
                await redis.set(`otphub:invoice:${invoice.trans_id}`, {
                    ...invoice,
                    user_id: String(userId),
                    request_id: requestId,
                    created_at: Date.now()
                }, { ex: 7200 });
            } catch (_) {}

            return { success: true, invoice };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    }

    // CHECKGD: Kiểm tra trạng thái hoá đơn
    async checkCheckGdInvoice(transId) {
        try {
            const res = await fetch(`https://checkgd.vn/api/v1/invoices/${transId}`, { cache: 'no-store' });
            const data = await res.json();
            if (data.success && data.data) {
                return { success: true, invoice: data.data };
            }
            return { success: false, msg: data.msg || 'Không tìm thấy hoá đơn' };
        } catch (e) {
            return { success: false, msg: e.message };
        }
    }
}
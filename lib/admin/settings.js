import { redis, KEYS } from '../redis.js';
import { BASE_SERVICES } from '../manager.js';

export default async function handler(req, res) {
    const auth = req.headers.authorization;
    if (!auth || Buffer.from(auth.replace('Bearer ', ''), 'base64').toString() !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    let cfg = (await redis.get(KEYS.CONFIG)) || {
        gsm_url: process.env.GSM_URL || '',
        admin_contact: process.env.ADMIN_CONTACT || '',
        prices: {},
        disabled_services: [],
        deleted_services: [],
        service_overrides: {},
        custom_services: []
    };

    if (req.method === 'GET') {
        const disabled = new Set(cfg.disabled_services || []);
        const deleted = new Set(cfg.deleted_services || []);
        const overrides = cfg.service_overrides || {};

        const base = BASE_SERVICES
            .filter(s => !deleted.has(s.id))
            .map(s => {
                const ov = overrides[s.id] || {};
                return {
                    id: s.id,
                    name: ov.name || s.name,
                    icon: ov.icon || s.icon,
                    price: cfg.prices?.[s.id] ?? ov.price ?? s.price,
                    pattern: ov.pattern !== undefined ? ov.pattern : s.pattern,
                    enabled: !disabled.has(s.id),
                    is_custom: false
                };
            });

        const custom = (cfg.custom_services || [])
            .filter(s => !deleted.has(s.id))
            .map(s => {
                const ov = overrides[s.id] || {};
                return {
                    id: s.id,
                    name: ov.name || s.name,
                    icon: ov.icon || s.icon || '📱',
                    price: cfg.prices?.[s.id] ?? ov.price ?? s.price,
                    pattern: ov.pattern !== undefined ? ov.pattern : s.pattern,
                    enabled: !disabled.has(s.id),
                    is_custom: true
                };
            });

        return res.status(200).json({
            gsm_url: cfg.gsm_url || process.env.GSM_URL || '',
            admin_contact: cfg.admin_contact || process.env.ADMIN_CONTACT || '',
            otistx_api_key: cfg.otistx_api_key || process.env.OTIS_API_KEY || '',
            services: [...base, ...custom]
        });
    }

    if (req.method === 'POST') {
        const { action, payload } = req.body || {};

        if (action === 'add_service') {
            const { id, name, icon, price, keywords, pattern } = payload || {};
            const cleanId = String(id || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
            if (!cleanId || cleanId.length < 2) {
                return res.status(400).json({ error: 'Mã dịch vụ không hợp lệ (tối thiểu 2 ký tự chữ hoặc số, ví dụ: whatsapp).' });
            }
            if (!name || !name.trim()) {
                return res.status(400).json({ error: 'Vui lòng nhập tên dịch vụ hiển thị.' });
            }

            cfg.custom_services = cfg.custom_services || [];
            cfg.deleted_services = (cfg.deleted_services || []).filter(x => x !== cleanId);

            if (cfg.custom_services.some(s => s.id === cleanId)) {
                return res.status(400).json({ error: `Mã dịch vụ "${cleanId}" đã tồn tại trong danh sách tự thêm!` });
            }

            let regexPattern = pattern?.trim();
            if (!regexPattern && keywords) {
                const kwList = Array.isArray(keywords)
                    ? keywords
                    : String(keywords).split(',').map(k => k.trim()).filter(Boolean);
                if (kwList.length) {
                    regexPattern = kwList.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                }
            }

            const newSvc = {
                id: cleanId,
                name: name.trim(),
                icon: (icon || '📱').trim(),
                price: Math.max(500, Number(price) || 3000),
                pattern: regexPattern || cleanId,
                keywords: Array.isArray(keywords) ? keywords : String(keywords || '').split(',').map(k => k.trim()).filter(Boolean)
            };

            cfg.custom_services.push(newSvc);
            cfg.prices = cfg.prices || {};
            cfg.prices[cleanId] = newSvc.price;
            await redis.set(KEYS.CONFIG, cfg);
            return res.status(200).json({ success: true, service: newSvc, message: `Đã thêm dịch vụ "${newSvc.name}" thành công!` });
        }

        if (action === 'update_service') {
            const { id, name, icon, price, pattern, keywords } = payload || {};
            if (!id) return res.status(400).json({ error: 'Thiếu mã dịch vụ cần sửa' });

            cfg.service_overrides = cfg.service_overrides || {};
            cfg.prices = cfg.prices || {};

            let regexPattern = pattern?.trim();
            if (pattern === undefined && keywords) {
                const kwList = Array.isArray(keywords)
                    ? keywords
                    : String(keywords).split(',').map(k => k.trim()).filter(Boolean);
                if (kwList.length) {
                    regexPattern = kwList.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                }
            }

            const currentOv = cfg.service_overrides[id] || {};
            const newOv = {
                ...currentOv,
                ...(name ? { name: name.trim() } : {}),
                ...(icon ? { icon: icon.trim() } : {}),
                ...(regexPattern !== undefined ? { pattern: regexPattern } : {}),
                ...(price !== undefined && !isNaN(Number(price)) ? { price: Number(price) } : {})
            };
            cfg.service_overrides[id] = newOv;

            if (price !== undefined && !isNaN(Number(price))) {
                cfg.prices[id] = Number(price);
            }

            // Nếu nằm trong custom_services, cập nhật trực tiếp cả trong custom_services
            cfg.custom_services = (cfg.custom_services || []).map(cs => {
                if (cs.id === id) {
                    return {
                        ...cs,
                        name: newOv.name || cs.name,
                        icon: newOv.icon || cs.icon,
                        price: newOv.price !== undefined ? newOv.price : cs.price,
                        pattern: newOv.pattern !== undefined ? newOv.pattern : cs.pattern,
                        keywords: keywords ? (Array.isArray(keywords) ? keywords : String(keywords).split(',').map(k => k.trim()).filter(Boolean)) : cs.keywords
                    };
                }
                return cs;
            });

            await redis.set(KEYS.CONFIG, cfg);
            return res.status(200).json({ success: true, message: `Đã cập nhật dịch vụ "${id}" thành công!` });
        }

        if (action === 'delete_service') {
            const { serviceId } = payload || {};
            if (!serviceId) return res.status(400).json({ error: 'Thiếu mã dịch vụ cần xóa' });

            const deleted = new Set(cfg.deleted_services || []);
            deleted.add(serviceId);
            cfg.deleted_services = Array.from(deleted);

            cfg.custom_services = (cfg.custom_services || []).filter(s => s.id !== serviceId);

            if (cfg.prices && cfg.prices[serviceId] !== undefined) {
                delete cfg.prices[serviceId];
            }
            if (cfg.service_overrides && cfg.service_overrides[serviceId] !== undefined) {
                delete cfg.service_overrides[serviceId];
            }

            await redis.set(KEYS.CONFIG, cfg);
            return res.status(200).json({ success: true, message: 'Đã xóa dịch vụ thành công!' });
        }

        if (action === 'restore_services') {
            cfg.deleted_services = [];
            cfg.service_overrides = {};
            await redis.set(KEYS.CONFIG, cfg);
            return res.status(200).json({ success: true, message: 'Đã khôi phục toàn bộ dịch vụ mặc định về ban đầu!' });
        }

        if (action === 'update_general') {
            cfg.gsm_url = payload.gsm_url !== undefined ? String(payload.gsm_url).trim() : (cfg.gsm_url || '');
            cfg.admin_contact = payload.admin_contact !== undefined ? String(payload.admin_contact).trim() : '';
            if (payload.otistx_api_key !== undefined) {
                cfg.otistx_api_key = String(payload.otistx_api_key).trim();
            }
            await redis.set(KEYS.CONFIG, cfg);
            return res.status(200).json({ success: true, message: 'Đã lưu cấu hình hệ thống thành công!' });
        }

        if (action === 'set_price') {
            cfg.prices = cfg.prices || {};
            cfg.prices[payload.serviceId] = Number(payload.price);
            cfg.service_overrides = cfg.service_overrides || {};
            cfg.service_overrides[payload.serviceId] = {
                ...(cfg.service_overrides[payload.serviceId] || {}),
                price: Number(payload.price)
            };
            await redis.set(KEYS.CONFIG, cfg);
            return res.status(200).json({ success: true });
        }

        if (action === 'toggle_service') {
            let disabled = new Set(cfg.disabled_services || []);
            if (disabled.has(payload.serviceId)) disabled.delete(payload.serviceId);
            else disabled.add(payload.serviceId);
            cfg.disabled_services = Array.from(disabled);
            await redis.set(KEYS.CONFIG, cfg);
            return res.status(200).json({ success: true });
        }

        if (action === 'reset_sims') {
            await redis.del(KEYS.USED_SERVICES);
            await redis.del(KEYS.USER_USED);
            return res.status(200).json({ success: true, message: 'Đã reset toàn bộ lịch sử SIM và lịch sử thuê của người dùng!' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

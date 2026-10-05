import { redis, KEYS } from '../../lib/redis.js';
import { BASE_SERVICES } from '../../lib/manager.js';

export default async function handler(req, res) {
    const auth = req.headers.authorization;
    if (!auth || Buffer.from(auth.replace('Bearer ', ''), 'base64').toString() !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    let cfg = (await redis.get(KEYS.CONFIG)) || {
        gsm_url: process.env.GSM_URL || '',
        admin_contact: process.env.ADMIN_CONTACT || '@tralaicuocsongchochinhminh',
        prices: {},
        disabled_services: []
    };

    if (req.method === 'GET') {
        const disabled = new Set(cfg.disabled_services || []);
        const services = BASE_SERVICES.map(s => ({
            id: s.id,
            name: s.name,
            icon: s.icon,
            price: cfg.prices?.[s.id] || s.price,
            enabled: !disabled.has(s.id)
        }));

        return res.status(200).json({
            config: {
                gsm_url: cfg.gsm_url,
                admin_contact: cfg.admin_contact
            },
            services
        });
    }

    if (req.method === 'POST') {
        const { action, payload } = req.body || {};

        if (action === 'update_general') {
            cfg.gsm_url = payload.gsm_url?.trim() || '';
            cfg.admin_contact = payload.admin_contact?.trim() || '';
            await redis.set(KEYS.CONFIG, cfg);
            return res.status(200).json({ success: true });
        }

        if (action === 'set_price') {
            cfg.prices = cfg.prices || {};
            cfg.prices[payload.serviceId] = Number(payload.price);
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
            return res.status(200).json({ success: true, message: 'Đã reset toàn bộ SIM về trạng thái mới!' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
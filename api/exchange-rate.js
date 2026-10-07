import { redis } from '../lib/redis.js';

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    // Cache header cho CDN (Vercel Edge cache 60s)
    res.setHeader('Cache-Control', 'public, s-maxage=60, max-age=60, stale-while-revalidate=30');

    const CACHE_KEY = 'otphub:exchange_rate_cache';
    let rate = null;

    try {
        // 1. Kiểm tra cache trong Redis (TTL 60s)
        const cached = await redis.get(CACHE_KEY);
        if (cached && !isNaN(Number(cached)) && Number(cached) > 0) {
            return res.status(200).json({
                success: true,
                data: {
                    rate: Number(cached)
                }
            });
        }
    } catch (_) {}

    try {
        // 2. Lấy tỉ giá USDT/VND realtime từ nguồn Binance P2P / CheckGD
        const resp = await fetch('https://checkgd.vn/api/exchange-rate', {
            cache: 'no-store',
            headers: { 'Accept': 'application/json' }
        });
        const json = await resp.json();
        if (json?.success && json?.data?.rate && !isNaN(Number(json.data.rate))) {
            rate = Number(json.data.rate);
        }
    } catch (err) {
        console.error('[Exchange Rate Fetch Error]:', err.message);
    }

    // Fallback an toàn nếu cả 2 nguồn đều trục trặc
    if (!rate || isNaN(rate) || rate <= 0) {
        rate = 26030;
    }

    // 3. Cập nhật cache 60 giây trong Redis
    try {
        await redis.set(CACHE_KEY, rate, { ex: 60 });
    } catch (_) {}

    return res.status(200).json({
        success: true,
        data: {
            rate
        }
    });
}

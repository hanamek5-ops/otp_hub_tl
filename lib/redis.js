import { Redis } from '@upstash/redis';

let _redis = null;
export function getRedis() {
    if (!_redis) {
        const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
        const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
        if (!url || !token) {
            throw new Error('[Redis Config Error] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variables');
        }
        _redis = new Redis({
            url,
            token
        });
    }
    return _redis;
}

export const redis = new Proxy({}, {
    get(target, prop) {
        const r = getRedis();
        const val = r[prop];
        if (typeof val === 'function') {
            return val.bind(r);
        }
        return val;
    }
});

export const KEYS = {
    CONFIG: 'otphub:config',
    USERS: 'otphub:users',
    API_KEYS: 'otphub:api_keys',
    SESSIONS: 'otphub:sessions',
    USED_SERVICES: 'otphub:used_services',
    USER_USED: 'otphub:user_used',
    SHOPEE_CACHE: 'otphub:shopee_cache',
    CRON_LOCK: 'otphub:cron_lock'
};
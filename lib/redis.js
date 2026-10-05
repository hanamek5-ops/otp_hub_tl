import { Redis } from '@upstash/redis';

let _redis = null;
export function getRedis() {
    if (!_redis) {
        const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
        const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
        if (!url || !token) {
            console.error('[Redis Config Error] Missing UPSTASH_REDIS_REST_URL/KV_REST_API_URL or UPSTASH_REDIS_REST_TOKEN/KV_REST_API_TOKEN');
        }
        _redis = new Redis({
            url: url || 'https://desired-possum-198445.upstash.io',
            token: token || 'gQAAAAAAAwctAAIgcDIzZjI2ZGQzYzA2MzA0NmZjOWQyN2VjNGM1MTYyODM5Yg'
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
    SESSIONS: 'otphub:sessions',
    USED_SERVICES: 'otphub:used_services',
    SHOPEE_CACHE: 'otphub:shopee_cache',
    CRON_LOCK: 'otphub:cron_lock'
};
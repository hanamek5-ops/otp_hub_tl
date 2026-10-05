import { Redis } from '@upstash/redis';

export const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const KEYS = {
    CONFIG: 'otphub:config',
    USERS: 'otphub:users',
    SESSIONS: 'otphub:sessions',
    USED_SERVICES: 'otphub:used_services',
    SHOPEE_CACHE: 'otphub:shopee_cache',
    CRON_LOCK: 'otphub:cron_lock'
};
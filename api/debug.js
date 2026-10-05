export default async function handler(req, res) {
    const envCheck = {
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? 'SET (' + process.env.TELEGRAM_BOT_TOKEN.slice(0, 10) + '...)' : 'NOT SET',
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ? 'SET (' + process.env.UPSTASH_REDIS_REST_URL.slice(0, 30) + '...)' : 'NOT SET',
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ? 'SET (length: ' + process.env.UPSTASH_REDIS_REST_TOKEN.length + ')' : 'NOT SET',
        ADMIN_SECRET_KEY: process.env.ADMIN_SECRET_KEY ? 'SET' : 'NOT SET',
        ADMIN_IDS: process.env.ADMIN_IDS || 'NOT SET',
        GSM_URL: process.env.GSM_URL ? 'SET' : 'NOT SET',
    };
    return res.status(200).json({ env: envCheck, timestamp: new Date().toISOString() });
}

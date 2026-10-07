import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tự động load biến môi trường từ .env.local hoặc .env
for (const envFile of ['.env.local', '.env']) {
    const fullPath = path.join(__dirname, envFile);
    if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const [k, ...v] = trimmed.split('=');
                const key = k.trim();
                const val = v.join('=').trim().replace(/^['"]|['"]$/g, '');
                if (!process.env[key]) {
                    process.env[key] = val;
                }
            }
        }
    }
}

// Import các handler API
import webhookHandler from './api/webhook.js';
import checkgdHandler from './api/checkgd-webhook.js';
import gsmHandler from './api/gsm-webhook.js';
import exchangeRateHandler from './api/exchange-rate.js';
import cronHandler from './api/cron.js';
import partnerHandler from './api/partner.js';
import adminRouteHandler from './api/admin/[route].js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS & Security Headers
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gsm-secret');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Helper bọc an toàn async error
const wrap = (fn) => async (req, res, next) => {
    try {
        await fn(req, res);
    } catch (err) {
        console.error('API Error:', err);
        if (!res.headersSent) {
            res.status(500).json({ status_code: 500, error: 'Internal Server Error', message: err.message });
        }
    }
};

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'otphub-bot', timestamp: new Date().toISOString() }));

// Phục vụ Web Landing Page & Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Định tuyến API Webhook & Tiện ích
app.all('/api/webhook', wrap(webhookHandler));
app.all('/api/checkgd-webhook', wrap(checkgdHandler));
app.all('/api/gsm-webhook', wrap(gsmHandler));
app.all('/api/exchange-rate', wrap(exchangeRateHandler));
app.all('/api/cron', wrap(cronHandler));

// Admin API
app.all('/api/admin/:route', wrap((req, res) => {
    req.query.route = req.params.route;
    return adminRouteHandler(req, res);
}));
app.all('/api/debug', wrap((req, res) => {
    req.query.route = 'debug';
    return adminRouteHandler(req, res);
}));

// Partner API (Các rewrite từ vercel.json cho tool thuê số)
const partnerAction = (action) => wrap((req, res) => {
    req.query.action = action;
    return partnerHandler(req, res);
});

app.all('/api/partner', wrap(partnerHandler));
app.all(['/users/balance', '/api/users/balance'], partnerAction('balance'));
app.all(['/service/getv2', '/api/service/getv2'], partnerAction('services'));
app.all(['/request/getv2', '/api/request/getv2'], partnerAction('request'));
app.all(['/session/getv2', '/api/session/getv2'], partnerAction('session'));
app.all(['/session/cancel', '/api/session/cancel'], partnerAction('cancel'));

// Trang chủ mặc định
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ OTPHub Bot & API Server đang chạy tại http://0.0.0.0:${PORT}`);
});

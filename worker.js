import fs from 'fs';
import { TelegramBot } from './lib/telegram.js';
import { OTPHubManager } from './lib/manager.js';

// Tự động load biến môi trường từ .env.local hoặc .env nếu chạy local/VPS
for (const envFile of ['.env.local', '.env']) {
    if (fs.existsSync(envFile)) {
        const content = fs.readFileSync(envFile, 'utf8');
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

if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ Thiếu TELEGRAM_BOT_TOKEN trong file môi trường (.env.local)');
    process.exit(1);
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const mgr = new OTPHubManager(bot);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('⚡ OTP HUB GSM — ULTRA-FAST REALTIME WORKER (< 2s)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🚀 Worker đang quét modem GSM liên tục mỗi 1.0 giây...');
console.log('👉 Khi có SMS chứa mã OTP, bot sẽ gửi tin nhắn Telegram tức thì!\n');

let loopCount = 0;
async function runWorker() {
    while (true) {
        loopCount++;
        const start = Date.now();
        try {
            const waitingCount = await mgr.pollMessages();
            const elapsed = Date.now() - start;

            if (waitingCount > 0) {
                const timeStr = new Date().toLocaleTimeString('vi-VN');
                console.log(`[${timeStr}] ⚡ Đang theo dõi ${waitingCount} đơn chờ OTP (Tốc độ phản hồi: ${elapsed}ms)`);
                // Khi có đơn chờ: quét cực nhanh mỗi 1000ms (1 giây)
                await sleep(Math.max(200, 1000 - elapsed));
            } else {
                if (loopCount % 30 === 0) {
                    const timeStr = new Date().toLocaleTimeString('vi-VN');
                    console.log(`[${timeStr}] 💤 Hệ thống sẵn sàng, chưa có đơn chờ OTP mới...`);
                }
                // Khi không có đơn: nghỉ 2.5 giây
                await sleep(2500);
            }
        } catch (e) {
            console.error('⚠️ Worker error:', e.message);
            await sleep(2000);
        }
    }
}

runWorker();

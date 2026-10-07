import { OTPHubManager } from '../manager.js';
import { TelegramBot } from '../telegram.js';

export default async function handler(req, res) {
    const auth = req.headers.authorization;
    if (!auth || Buffer.from(auth.replace('Bearer ', ''), 'base64').toString() !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
        const mgr = new OTPHubManager(bot);
        const modems = await mgr.fetchGsmModems();
        const cfg = await mgr.getConfig();

        return res.status(200).json({
            gsm_url: cfg.gsm_url ? 'Đã cấu hình' : 'Chưa cấu hình',
            total_modems: modems.length,
            modems
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

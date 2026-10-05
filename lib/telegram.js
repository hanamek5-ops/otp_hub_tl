export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export class TelegramBot {
    constructor(token) {
        this._token = token;
    }

    get token() {
        return (this._token || process.env.TELEGRAM_BOT_TOKEN || '8637510028:AAFXIwofDrILi4C6-CyGnEVR3A9rySb8CkQ').trim();
    }

    get apiUrl() {
        return `https://api.telegram.org/bot${this.token}`;
    }

    async apiCall(method, payload = null) {
        const url = `${this.apiUrl}/${method}`;
        const opts = {
            method: payload ? 'POST' : 'GET',
            headers: { 'Content-Type': 'application/json' },
        };
        if (payload) opts.body = JSON.stringify(payload);

        try {
            const res = await fetch(url, opts);
            const data = await res.json();
            if (!data.ok) {
                console.error(`[Telegram API Error] ${method}:`, data);
            }
            return data;
        } catch (err) {
            console.error(`[Telegram Network Error] ${method}:`, err.message);
            return { ok: false, description: err.message };
        }
    }

    async sendMessage(chat_id, text, reply_markup = null, parse_mode = 'HTML') {
        const payload = { chat_id, text, disable_web_page_preview: true };
        if (parse_mode) payload.parse_mode = parse_mode;
        if (reply_markup) payload.reply_markup = reply_markup;
        const res = await this.apiCall('sendMessage', payload);
        if (!res.ok && res.description && res.description.includes("can't parse entities") && parse_mode) {
            console.warn('[TelegramBot] HTML parse failed, resending as plain text...');
            const plainText = text.replace(/<[^>]*>/g, '');
            return this.sendMessage(chat_id, plainText, reply_markup, null);
        }
        return res;
    }

    async editMessage(chat_id, message_id, text, reply_markup = null, parse_mode = 'HTML') {
        const payload = { chat_id, message_id, text, disable_web_page_preview: true };
        if (parse_mode) payload.parse_mode = parse_mode;
        if (reply_markup) payload.reply_markup = reply_markup;
        const res = await this.apiCall('editMessageText', payload);
        if (!res.ok && res.description && res.description.includes("can't parse entities") && parse_mode) {
            console.warn('[TelegramBot] HTML parse failed, re-editing as plain text...');
            const plainText = text.replace(/<[^>]*>/g, '');
            return this.editMessage(chat_id, message_id, plainText, reply_markup, null);
        }
        return res;
    }

    answerCallbackQuery(callback_query_id, text = null, show_alert = false) {
        const payload = { callback_query_id };
        if (text) {
            payload.text = text;
            payload.show_alert = show_alert;
        }
        return this.apiCall('answerCallbackQuery', payload);
    }
}
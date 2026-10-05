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

    sendMessage(chat_id, text, reply_markup = null, parse_mode = 'HTML') {
        const payload = { chat_id, text, parse_mode, disable_web_page_preview: true };
        if (reply_markup) payload.reply_markup = reply_markup;
        return this.apiCall('sendMessage', payload);
    }

    editMessage(chat_id, message_id, text, reply_markup = null, parse_mode = 'HTML') {
        const payload = { chat_id, message_id, text, parse_mode, disable_web_page_preview: true };
        if (reply_markup) payload.reply_markup = reply_markup;
        return this.apiCall('editMessageText', payload);
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
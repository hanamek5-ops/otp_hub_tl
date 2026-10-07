import authHandler from '../../lib/admin/auth.js';
import usersHandler from '../../lib/admin/users.js';
import settingsHandler from '../../lib/admin/settings.js';
import sessionsHandler from '../../lib/admin/sessions.js';
import statsHandler from '../../lib/admin/stats.js';
import modemsHandler from '../../lib/admin/modems.js';
import debugHandler from '../../lib/admin/debug.js';

const ROUTE_HANDLERS = {
    auth: authHandler,
    users: usersHandler,
    settings: settingsHandler,
    sessions: sessionsHandler,
    stats: statsHandler,
    modems: modemsHandler,
    debug: debugHandler
};

export default async function handler(req, res) {
    const rawRoute = req.query?.route || req.url?.split('?')[0].split('/').filter(Boolean).pop();
    const route = String(rawRoute || '').toLowerCase().trim();

    const targetHandler = ROUTE_HANDLERS[route];
    if (!targetHandler) {
        return res.status(404).json({ error: `Admin route '${route}' not found` });
    }

    return targetHandler(req, res);
}

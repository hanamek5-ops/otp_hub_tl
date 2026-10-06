import { OTPHubManager } from '../lib/manager.js';
import { redis, KEYS } from '../lib/redis.js';

const mgr = new OTPHubManager(null);

function parseSession(s) {
    if (typeof s === 'string') {
        try { return JSON.parse(s); } catch { return { raw: s }; }
    }
    return s || {};
}

// 1. Kiểm tra số dư ví
async function handleBalance(req, res) {
    const token = req.query.token || req.query.api_key || req.body?.token || req.body?.api_key;
    if (!token) {
        return res.status(401).json({
            status_code: 401,
            message: 'Thiếu tham số token (hoặc api_key)',
            data: null
        });
    }

    const user = await mgr.getUserByApiKey(token);
    if (!user) {
        return res.status(401).json({
            status_code: 401,
            message: 'Token không hợp lệ hoặc tài khoản không tồn tại',
            data: null
        });
    }

    return res.status(200).json({
        status_code: 200,
        message: 'Success',
        data: {
            balance: Number(user.balance || 0)
        }
    });
}

// 2. Danh sách dịch vụ & giá
async function handleServices(req, res) {
    const services = await mgr.getServices();
    const cfg = await mgr.getConfig();
    const enabledServices = services
        .filter(s => s.enabled)
        .map(s => ({
            id: s.id,
            name: s.name,
            price: Number(s.price || 0)
        }));

    return res.status(200).json({
        status_code: 200,
        message: 'Success',
        contact: cfg.admin_contact || process.env.ADMIN_CONTACT || '',
        data: enabledServices
    });
}

// 3. Yêu cầu cấp số điện thoại (Thuê số)
async function handleRequest(req, res) {
    const token = req.query.token || req.query.api_key || req.body?.token || req.body?.api_key;
    const rawServiceId = req.query.serviceId || req.query.service_id || req.query.service || req.body?.serviceId || req.body?.service_id || req.body?.service;

    if (!token) {
        return res.status(401).json({
            status_code: 401,
            message: 'Thiếu tham số token (hoặc api_key)',
            data: null
        });
    }

    if (!rawServiceId) {
        return res.status(400).json({
            status_code: 400,
            message: 'Thiếu tham số serviceId (mã dịch vụ)',
            data: null
        });
    }

    const user = await mgr.getUserByApiKey(token);
    if (!user) {
        return res.status(401).json({
            status_code: 401,
            message: 'Token không hợp lệ hoặc tài khoản không tồn tại',
            data: null
        });
    }

    const services = await mgr.getServices();
    const cleanSvcInput = String(rawServiceId).trim().toLowerCase();

    let targetService = services.find(s => s.id.toLowerCase() === cleanSvcInput);
    if (!targetService) {
        const numIdx = parseInt(cleanSvcInput, 10);
        if (!isNaN(numIdx) && numIdx > 0 && numIdx <= services.length) {
            targetService = services[numIdx - 1];
        }
    }
    if (!targetService) {
        targetService = services.find(s => s.name.toLowerCase().includes(cleanSvcInput));
    }

    if (!targetService || !targetService.enabled) {
        return res.status(400).json({
            status_code: 400,
            message: `Dịch vụ '${rawServiceId}' không tồn tại hoặc đang tạm ngưng`,
            data: null
        });
    }

    const result = await mgr.rentService(user.id, targetService.id);
    if (!result.success) {
        const cleanMsg = String(result.msg || 'Không có số khả dụng')
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return res.status(400).json({
            status_code: 400,
            message: cleanMsg,
            data: null
        });
    }

    const session = result.session;
    const freshUser = await mgr.getUser({ id: user.id });

    return res.status(200).json({
        status_code: 200,
        message: 'Success',
        data: {
            request_id: session.id,
            phone_number: session.phone_number,
            service_id: session.service_id,
            service_name: session.service_name,
            price: Number(session.price || 0),
            status: 0,
            created_time: session.created_at,
            balance: Number(freshUser.balance || 0)
        }
    });
}

// 4. Lấy mã OTP & Trạng thái phiên
async function handleSession(req, res) {
    const token = req.query.token || req.query.api_key || req.body?.token || req.body?.api_key;
    const reqId = req.query.requestId || req.query.request_id || req.query.sessionId || req.query.session_id || req.body?.requestId || req.body?.request_id || req.body?.sessionId;

    if (!token) {
        return res.status(401).json({
            status_code: 401,
            message: 'Thiếu tham số token (hoặc api_key)',
            data: null
        });
    }

    if (!reqId) {
        return res.status(400).json({
            status_code: 400,
            message: 'Thiếu tham số requestId',
            data: null
        });
    }

    const user = await mgr.getUserByApiKey(token);
    if (!user) {
        return res.status(401).json({
            status_code: 401,
            message: 'Token không hợp lệ hoặc tài khoản không tồn tại',
            data: null
        });
    }

    const rawSessions = (await redis.lrange(KEYS.SESSIONS, 0, 500)) || [];
    const sessions = rawSessions.map(parseSession);
    const session = sessions.find(s => s.id === reqId && String(s.user_id) === String(user.id));

    if (!session) {
        return res.status(404).json({
            status_code: 404,
            message: `Không tìm thấy phiên thuê ${reqId} của tài khoản này`,
            data: null
        });
    }

    let sessionStatusCode = 0;
    if (session.status === 'success') {
        sessionStatusCode = 1;
    } else if (session.status === 'refunded' || session.status === 'cancelled' || session.status === 'expired') {
        sessionStatusCode = 2;
    } else if (Date.now() >= (session.end_time || 0) && session.status === 'waiting') {
        sessionStatusCode = 2;
    }

    return res.status(200).json({
        status_code: 200,
        message: 'Success',
        data: {
            ID: session.id,
            Phone: session.phone_number,
            ServiceID: session.service_id,
            ServiceName: session.service_name,
            Status: sessionStatusCode,
            Price: Number(session.price || 0),
            Code: session.otp || session.otp_code || null,
            SmsContent: session.sms_text || null,
            IsSound: false,
            CreatedTime: session.created_at || new Date(session.start_time || Date.now()).toISOString()
        }
    });
}

// 5. Hủy yêu cầu & Hoàn tiền
async function handleCancel(req, res) {
    const token = req.query.token || req.query.api_key || req.body?.token || req.body?.api_key;
    const reqId = req.query.requestId || req.query.request_id || req.query.sessionId || req.query.session_id || req.body?.requestId || req.body?.request_id || req.body?.sessionId;

    if (!token) {
        return res.status(401).json({
            status_code: 401,
            message: 'Thiếu tham số token (hoặc api_key)',
            data: null
        });
    }

    if (!reqId) {
        return res.status(400).json({
            status_code: 400,
            message: 'Thiếu tham số requestId',
            data: null
        });
    }

    const user = await mgr.getUserByApiKey(token);
    if (!user) {
        return res.status(401).json({
            status_code: 401,
            message: 'Token không hợp lệ hoặc tài khoản không tồn tại',
            data: null
        });
    }

    const rawSessions = (await redis.lrange(KEYS.SESSIONS, 0, 1000)) || [];
    const sessions = rawSessions.map(parseSession);
    const targetIndex = sessions.findIndex(s => s.id === reqId && String(s.user_id) === String(user.id));

    if (targetIndex === -1) {
        return res.status(404).json({
            status_code: 404,
            message: `Không tìm thấy yêu cầu ${reqId} của tài khoản này`,
            data: null
        });
    }

    const session = sessions[targetIndex];

    if (session.status === 'success') {
        return res.status(400).json({
            status_code: 400,
            message: 'Yêu cầu này đã nhận được mã OTP thành công, không thể hủy!',
            data: null
        });
    }

    if (session.status === 'cancelled' || session.status === 'refunded') {
        return res.status(400).json({
            status_code: 400,
            message: 'Yêu cầu này đã được hủy hoặc hoàn tiền trước đó',
            data: null
        });
    }

    const now = Date.now();
    const elapsedSeconds = Math.floor((now - (session.start_time || now)) / 1000);
    if (elapsedSeconds < 30) {
        return res.status(400).json({
            status_code: 400,
            message: `Vui lòng đợi tối thiểu 30 giây trước khi hủy số (còn ${30 - elapsedSeconds}s)`,
            data: null
        });
    }

    session.status = 'cancelled';
    sessions[targetIndex] = session;

    await redis.del(KEYS.SESSIONS);
    if (sessions.length) {
        await redis.rpush(KEYS.SESSIONS, ...sessions);
    }

    const newBalance = await mgr.updateBalance(user.id, session.price);

    return res.status(200).json({
        status_code: 200,
        message: 'Hủy yêu cầu thành công, số tiền đã được hoàn lại vào ví',
        data: {
            ID: session.id,
            Status: 2,
            Refunded: Number(session.price || 0),
            Balance: Number(newBalance)
        }
    });
}

// Router chính
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const action = req.query.action || '';
    const url = req.url || '';

    try {
        if (action === 'balance' || url.includes('/balance')) {
            return await handleBalance(req, res);
        }
        if (action === 'services' || url.includes('/service/getv2') || url.includes('/services')) {
            return await handleServices(req, res);
        }
        if (action === 'request' || url.includes('/request/getv2') || url.includes('/rent')) {
            return await handleRequest(req, res);
        }
        if (action === 'session' || url.includes('/session/getv2')) {
            return await handleSession(req, res);
        }
        if (action === 'cancel' || url.includes('/session/cancel')) {
            return await handleCancel(req, res);
        }

        return res.status(400).json({
            status_code: 400,
            message: 'Endpoint API không hợp lệ hoặc thiếu action',
            data: null
        });
    } catch (e) {
        return res.status(500).json({
            status_code: 500,
            message: 'Lỗi máy chủ: ' + e.message,
            data: null
        });
    }
}

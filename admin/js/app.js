// OTPHub Admin Master Controller
let authToken = localStorage.getItem('otphub_admin_token') || '';
let currentTab = 'overview';
let cachedUsers = [];
let cachedSessions = [];
let cachedServices = [];
let cachedModems = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initRouting();
});

// Toast notification helper
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Authentication
function initAuth() {
    if (!authToken) {
        document.getElementById('login-modal').classList.add('active');
    } else {
        loadCurrentPage();
        setInterval(autoRefreshLiveData, 20000); // 20s auto refresh
    }
}

async function handleLogin() {
    const password = document.getElementById('login-password').value.trim();
    if (!password) return showToast('Vui lòng nhập mật khẩu quản trị', 'error');

    try {
        const res = await fetch('/api/admin/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (res.ok && data.token) {
            authToken = data.token;
            localStorage.setItem('otphub_admin_token', authToken);
            document.getElementById('login-modal').classList.remove('active');
            showToast('Đăng nhập quản trị thành công!', 'success');
            loadCurrentPage();
        } else {
            showToast(data.error || 'Mật khẩu sai!', 'error');
        }
    } catch (e) {
        showToast('Lỗi kết nối máy chủ: ' + e.message, 'error');
    }
}

function handleLogout() {
    if (confirm('Bạn có chắc muốn đăng xuất khỏi trang quản trị?')) {
        localStorage.removeItem('otphub_admin_token');
        authToken = '';
        location.reload();
    }
}

// Routing
function initRouting() {
    window.addEventListener('hashchange', () => {
        const hash = location.hash.replace('#', '') || 'overview';
        switchTab(hash);
    });

    const initial = location.hash.replace('#', '') || 'overview';
    switchTab(initial);
}

function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tabId);
    });
    document.querySelectorAll('.page-tab').forEach(el => {
        el.classList.toggle('active', el.id === `tab-${tabId}`);
    });

    // Update Topbar Title
    const titles = {
        overview: 'Tổng quan Hệ thống',
        users: 'Quản lý Khách hàng & Số dư',
        services: 'Bảng giá & Dịch vụ OTP',
        modems: 'Cổng SIM & Modem GSM',
        sessions: 'Lịch sử Thuê số & Mã OTP',
        settings: 'Cài đặt Hệ thống'
    };
    document.getElementById('topbar-page-title').innerText = titles[tabId] || 'Trang Quản trị';
    loadCurrentPage();
}

function loadCurrentPage() {
    if (!authToken) return;
    switch (currentTab) {
        case 'overview': loadOverview(); break;
        case 'users': loadUsers(); break;
        case 'services': loadServices(); break;
        case 'modems': loadModems(); break;
        case 'sessions': loadSessions(); break;
        case 'settings': loadSettings(); break;
    }
}

function autoRefreshLiveData() {
    if (!authToken) return;
    if (currentTab === 'overview') loadOverview(true);
    if (currentTab === 'modems') loadModems(true);
}

// API Helper
async function apiRequest(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        ...(options.headers || {})
    };
    const res = await fetch(endpoint, { ...options, headers });
    if (res.status === 401) {
        showToast('Phiên làm việc hết hạn, vui lòng đăng nhập lại', 'error');
        handleLogout();
        throw new Error('Unauthorized');
    }
    return res.json();
}

// 1. Overview Page
async function loadOverview(silent = false) {
    try {
        const data = await apiRequest('/api/admin/stats');
        document.getElementById('stat-total-users').innerText = (data.totalUsers || 0).toLocaleString();
        document.getElementById('stat-total-balance').innerText = (data.totalBalance || 0).toLocaleString('vi-VN') + ' đ';
        document.getElementById('stat-revenue').innerText = (data.revenue || 0).toLocaleString('vi-VN') + ' đ';
        
        const successRate = data.totalSessions ? Math.round((data.successSessions / data.totalSessions) * 100) : 0;
        document.getElementById('stat-success-rate').innerText = `${data.successSessions || 0} / ${data.totalSessions || 0} (${successRate}%)`;

        // Render Recent Sessions table
        const tbody = document.getElementById('overview-recent-sessions');
        if (tbody) {
            tbody.innerHTML = (data.recentSessions || []).slice(0, 8).map(s => `
                <tr>
                    <td><code>#${(s.id || '').slice(0, 8)}</code></td>
                    <td><b>${s.user_id}</b></td>
                    <td>${s.service_name || s.service_id}</td>
                    <td><code>${s.phone_number || '---'}</code></td>
                    <td><b style="color: #6ee7b7; font-size: 15px;">${s.otp_code || '---'}</b></td>
                    <td>
                        <span class="badge ${s.status === 'success' ? 'badge-success' : (s.status === 'timeout' ? 'badge-danger' : 'badge-warning')}">
                            ${s.status === 'success' ? 'Thành công' : (s.status === 'timeout' ? 'Hết hạn/Hoàn tiền' : 'Đang chờ')}
                        </span>
                    </td>
                    <td>${new Date(s.created_at).toLocaleTimeString('vi-VN')}</td>
                </tr>
            `).join('') || '<tr><td colspan="7" style="text-align: center; color: var(--text-subtle);">Chưa có phiên OTP nào</td></tr>';
        }
    } catch (e) {
        if (!silent) showToast('Lỗi tải dữ liệu tổng quan', 'error');
    }
}

// 2. Users Page
async function loadUsers() {
    try {
        const users = await apiRequest('/api/admin/users');
        cachedUsers = users || [];
        renderUsersTable(cachedUsers);
    } catch (e) {
        showToast('Lỗi tải danh sách người dùng', 'error');
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('users-table-body');
    const keyword = (document.getElementById('user-search-input')?.value || '').trim().toLowerCase();
    
    const filtered = users.filter(u => {
        const idMatch = String(u.id || '').toLowerCase().includes(keyword);
        const nameMatch = String(u.name || '').toLowerCase().includes(keyword);
        const userMatch = String(u.username || '').toLowerCase().includes(keyword);
        return idMatch || nameMatch || userMatch;
    });

    tbody.innerHTML = filtered.map(u => `
        <tr>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <code>${u.id}</code>
                    <button class="btn btn-secondary" style="padding: 2px 6px; font-size: 10px;" onclick="navigator.clipboard.writeText('${u.id}'); showToast('Đã chép ID');">Copy</button>
                </div>
            </td>
            <td><b>${u.name || 'Khách hàng'}</b></td>
            <td>${u.username ? '@' + u.username : '<span style="color: var(--text-subtle);">Chưa đặt</span>'}</td>
            <td><b style="color: #6ee7b7; font-size: 14px;">${Number(u.balance || 0).toLocaleString('vi-VN')} đ</b></td>
            <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('vi-VN') : '---'}</td>
            <td>
                <button class="btn btn-primary" style="padding: 4px 10px; font-size: 12px;" onclick="openBalanceModal('${u.id}', '${u.name || u.id}', ${u.balance || 0})">
                    💳 Nạp / Trừ tiền
                </button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6" style="text-align: center; color: var(--text-subtle);">Không tìm thấy người dùng</td></tr>';

    document.getElementById('user-count-badge').innerText = `${filtered.length} tài khoản`;
}

function filterUsers() {
    renderUsersTable(cachedUsers);
}

function openBalanceModal(userId = '', name = '', currentBalance = 0) {
    document.getElementById('modal-balance-uid').value = userId;
    document.getElementById('modal-balance-name').innerText = name ? `Tài khoản: ${name} (ID: ${userId})` : 'Cộng/Trừ tiền theo ID';
    document.getElementById('modal-balance-current').innerText = Number(currentBalance).toLocaleString('vi-VN') + ' đ';
    document.getElementById('modal-balance-amount').value = '';
    document.getElementById('balance-modal').classList.add('active');
}

function closeBalanceModal() {
    document.getElementById('balance-modal').classList.remove('active');
}

async function submitBalanceUpdate() {
    const userId = document.getElementById('modal-balance-uid').value.trim();
    const amount = Number(document.getElementById('modal-balance-amount').value.trim());

    if (!userId) return showToast('Vui lòng nhập User ID', 'error');
    if (isNaN(amount) || amount === 0) return showToast('Vui lòng nhập số tiền hợp lệ (dương để nạp, âm để trừ)', 'error');

    try {
        const res = await apiRequest('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify({ userId, amount })
        });
        showToast(`Cập nhật thành công! Số dư mới: ${Number(res.balance).toLocaleString('vi-VN')} đ`, 'success');
        closeBalanceModal();
        loadUsers();
        loadOverview(true);
    } catch (e) {
        showToast('Lỗi cập nhật: ' + e.message, 'error');
    }
}

// 3. Services & Pricing Page
async function loadServices() {
    try {
        const data = await apiRequest('/api/admin/settings');
        cachedServices = data.services || [];
        renderServicesTable(cachedServices);
    } catch (e) {
        showToast('Lỗi tải danh sách dịch vụ', 'error');
    }
}

function renderServicesTable(services) {
    const tbody = document.getElementById('services-table-body');
    tbody.innerHTML = services.map(s => `
        <tr>
            <td style="font-size: 20px; width: 40px;">${s.icon || '⚡'}</td>
            <td>
                <b>${s.name}</b>
                <div style="font-size: 11px; color: var(--text-subtle);">Mã ID: <code>${s.id}</code></div>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="number" class="form-control" id="price-input-${s.id}" value="${s.price}" style="width: 120px;" step="100" min="0">
                    <span style="font-size: 12px; color: var(--text-muted);">đ</span>
                    <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="saveSinglePrice('${s.id}')">Lưu giá</button>
                </div>
            </td>
            <td>
                <label class="switch">
                    <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleServiceStatus('${s.id}')">
                    <span class="slider"></span>
                </label>
            </td>
        </tr>
    `).join('');
}

async function saveSinglePrice(serviceId) {
    const input = document.getElementById(`price-input-${serviceId}`);
    const price = Number(input.value);
    if (isNaN(price) || price < 0) return showToast('Giá tiền không hợp lệ', 'error');

    try {
        await apiRequest('/api/admin/settings', {
            method: 'POST',
            body: JSON.stringify({ action: 'set_price', payload: { serviceId, price } })
        });
        showToast(`Đã lưu giá dịch vụ ${serviceId} thành ${price.toLocaleString('vi-VN')} đ`, 'success');
    } catch (e) {
        showToast('Lỗi lưu giá: ' + e.message, 'error');
    }
}

async function toggleServiceStatus(serviceId) {
    try {
        await apiRequest('/api/admin/settings', {
            method: 'POST',
            body: JSON.stringify({ action: 'toggle_service', payload: { serviceId } })
        });
        showToast('Đã đổi trạng thái dịch vụ', 'success');
        loadServices();
    } catch (e) {
        showToast('Lỗi cập nhật trạng thái', 'error');
    }
}

// 4. GSM Modems Page
async function loadModems(silent = false) {
    try {
        const data = await apiRequest('/api/admin/modems');
        cachedModems = data.modems || [];
        
        document.getElementById('modem-total-count').innerText = `${data.total_modems || 0} Cổng Online`;
        document.getElementById('modem-gsm-status').innerText = data.gsm_url;

        const tbody = document.getElementById('modems-table-body');
        tbody.innerHTML = (cachedModems).map((m, idx) => `
            <tr>
                <td><b>#${idx + 1}</b></td>
                <td><span class="badge badge-secondary">${m.port || 'Port ' + (idx + 1)}</span></td>
                <td><code style="font-size: 14px; font-weight: 600; color: #a5b4fc;">${m.phone_number}</code></td>
                <td>
                    <span class="badge ${m.operator.includes('Viettel') ? 'badge-danger' : (m.operator.includes('Vina') ? 'badge-primary' : 'badge-warning')}">
                        ${m.operator || 'SIM'}
                    </span>
                </td>
                <td>
                    <span class="status-indicator" style="padding: 2px 8px; font-size: 11px;">
                        <span class="pulse-dot"></span> Sẵn sàng
                    </span>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align: center; color: var(--text-subtle);">Không tìm thấy SIM modem nào đang cắm hoặc GSM URL chưa đúng</td></tr>';
    } catch (e) {
        if (!silent) showToast('Lỗi tải danh sách GSM modem', 'error');
    }
}

async function resetSimHistory() {
    if (!confirm('Bạn có chắc muốn Reset toàn bộ lịch sử SIM? Điều này cho phép khách hàng thuê lại tất cả các số như SIM mới.')) return;
    try {
        const res = await apiRequest('/api/admin/settings', {
            method: 'POST',
            body: JSON.stringify({ action: 'reset_sims' })
        });
        showToast(res.message || 'Đã reset toàn bộ lịch sử SIM!', 'success');
    } catch (e) {
        showToast('Lỗi reset SIM: ' + e.message, 'error');
    }
}

// 5. Sessions Page
async function loadSessions() {
    try {
        const data = await apiRequest('/api/admin/sessions');
        cachedSessions = data.sessions || [];
        renderSessionsTable(cachedSessions);
    } catch (e) {
        showToast('Lỗi tải lịch sử phiên OTP', 'error');
    }
}

function renderSessionsTable(sessions) {
    const tbody = document.getElementById('sessions-table-body');
    const keyword = (document.getElementById('session-search-input')?.value || '').trim().toLowerCase();

    const filtered = sessions.filter(s => {
        const phoneMatch = String(s.phone_number || '').includes(keyword);
        const userMatch = String(s.user_id || '').includes(keyword);
        const serviceMatch = String(s.service_name || s.service_id || '').toLowerCase().includes(keyword);
        const otpMatch = String(s.otp_code || '').includes(keyword);
        return phoneMatch || userMatch || serviceMatch || otpMatch;
    });

    tbody.innerHTML = filtered.map(s => `
        <tr>
            <td><code>#${(s.id || '').slice(0, 8)}</code></td>
            <td><b>${s.user_id}</b></td>
            <td>${s.service_name || s.service_id}</td>
            <td><code style="font-weight: 600;">${s.phone_number || '---'}</code></td>
            <td><b style="color: #6ee7b7; font-size: 16px; letter-spacing: 1px;">${s.otp_code || '---'}</b></td>
            <td>${Number(s.price || 0).toLocaleString('vi-VN')} đ</td>
            <td>
                <span class="badge ${s.status === 'success' ? 'badge-success' : (s.status === 'timeout' ? 'badge-danger' : 'badge-warning')}">
                    ${s.status === 'success' ? 'Thành công' : (s.status === 'timeout' ? 'Hoàn tiền' : 'Đang chờ')}
                </span>
            </td>
            <td>${new Date(s.created_at).toLocaleString('vi-VN')}</td>
        </tr>
    `).join('') || '<tr><td colspan="8" style="text-align: center; color: var(--text-subtle);">Chưa có phiên nào</td></tr>';
}

function filterSessions() {
    renderSessionsTable(cachedSessions);
}

// 6. Settings Page
async function loadSettings() {
    try {
        const data = await apiRequest('/api/admin/settings');
        const cfg = data.config || {};
        document.getElementById('cfg-gsm-url').value = cfg.gsm_url || '';
        document.getElementById('cfg-admin-contact').value = cfg.admin_contact || '';
    } catch (e) {
        showToast('Lỗi tải cấu hình hệ thống', 'error');
    }
}

async function saveGeneralSettings() {
    const gsm_url = document.getElementById('cfg-gsm-url').value.trim();
    const admin_contact = document.getElementById('cfg-admin-contact').value.trim();

    try {
        await apiRequest('/api/admin/settings', {
            method: 'POST',
            body: JSON.stringify({
                action: 'update_general',
                payload: { gsm_url, admin_contact }
            })
        });
        showToast('Đã lưu cấu hình hệ thống thành công!', 'success');
    } catch (e) {
        showToast('Lỗi lưu cấu hình: ' + e.message, 'error');
    }
}

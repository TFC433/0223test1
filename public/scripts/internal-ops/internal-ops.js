// public/scripts/internal-ops/internal-ops.js
/**
 * public/scripts/internal-ops/internal-ops.js
 * 內部運營與進度追蹤 前端模組 (Phase 4.8)
 * @version 1.7.6
 * @date 2026-04-22
 * @changelog
 * - [1.7.6] UI Patch: Refined Dev Projects table layout. Reordered columns, merged actual and theoretical progress into a single stacked column, and converted action buttons into an expandable toggle.
 * - [1.7.5] UI Patch: Upgraded Dev Projects table. Added start date and theoretical progress bar, removed update time column.
 * - [1.7.4] UI Patch: Replaced featureName with productName in Team Workload, removed unused columns, and added workload bar.
 * - [1.7.3] UI Patch: Added collapsible behavior to Team Workload member groups.
 * - [1.7.2] UI Patch: Unified visual language, headers, spacing, and table/card tones across all three sections.
 * - [1.7.1] UI Patch: Added compact visual progress bar to Dev Projects table.
 * - [1.7.0] Normalized Color System - Implemented single-source color strategy.
 * @description 負責進度追蹤頁面的 DOM 建立與資料渲染 (團隊成員負荷、開發案件追蹤、訂閱制管理)
 */

function hexToRgb(hex) {
    if (!hex) return null;
    const cleaned = hex.replace('#', '');
    const bigint = parseInt(cleaned, 16);
    if (isNaN(bigint)) return null;
    return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255
    };
}

function buildColorSet(hex) {
    let rgb = hexToRgb(hex);
    if (!rgb) {
        hex = '#616161';
        rgb = hexToRgb(hex);
    }
    if (!rgb) return null;

    return {
        text: hex,
        bgLight: `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`,
        bgMid: `rgba(${rgb.r},${rgb.g},${rgb.b},0.18)`,
        border: `rgba(${rgb.r},${rgb.g},${rgb.b},0.28)`
    };
}

window.loadInternalOpsPage = async function(params) {
    const pageContainer = document.getElementById('page-internal-ops');
    if (!pageContainer) return;

    if (!pageContainer.querySelector('.internal-ops-container')) {
        pageContainer.innerHTML = `
            <div class="internal-ops-container dashboard-grid-flexible" style="display: flex; flex-direction: column; gap: 24px; padding: 24px;">
                
                <div class="dashboard-widget internal-ops-widget" style="width: 100%;">
                    <div class="widget-header internal-ops-header">
                        <h2 class="widget-title">開發案件追蹤</h2>
                        <button class="action-btn primary btn-sm" onclick="openDevProjectModal()">
                            <span class="btn-text">新增</span>
                        </button>
                    </div>
                    <div class="widget-content internal-ops-content no-pad" id="internal-ops-dev-projects-content" style="overflow-x: auto;">
                    </div>
                </div>

                <div class="dashboard-widget internal-ops-widget" style="width: 100%;">
                    <div class="widget-header internal-ops-header">
                        <h2 class="widget-title">團隊成員負荷</h2>
                    </div>
                    <div class="widget-content internal-ops-content with-pad" id="internal-ops-team-workload-content" style="overflow-x: auto;">
                    </div>
                </div>

                <div class="dashboard-widget internal-ops-widget" style="width: 100%;">
                    <div class="widget-header internal-ops-header">
                        <h2 class="widget-title">訂閱制管理</h2>
                        <button class="action-btn primary btn-sm" onclick="alert('TODO: 新增訂閱紀錄 開發中')">
                            <span class="btn-text">新增</span>
                        </button>
                    </div>
                    <div class="widget-content internal-ops-content no-pad" id="internal-ops-subscriptions-content" style="overflow-x: auto;">
                    </div>
                </div>

            </div>
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            /* Widget Layout Unification */
            .internal-ops-widget { background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px rgba(0,0,0,0.05); overflow: hidden; }
            .internal-ops-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; background: #fff; }
            .internal-ops-header h2 { margin: 0; font-size: 1.1rem; color: #111827; font-weight: 600; }
            .internal-ops-content.no-pad { padding: 0; }
            .internal-ops-content.with-pad { padding: 20px; }
            
            /* Table Unification */
            .internal-ops-table { width: 100%; border-collapse: collapse; min-width: 900px; }
            .internal-ops-table th { background-color: #f9fafb; font-weight: 600; color: #4b5563; padding: 12px 20px; border-bottom: 1px solid #e5e7eb; text-align: left; font-size: 0.85rem; letter-spacing: 0.02em; }
            .internal-ops-table td { padding: 12px 20px; border-bottom: 1px solid #e5e7eb; text-align: left; font-size: 0.9rem; color: #374151; vertical-align: middle; }
            .internal-ops-table tr:last-child td { border-bottom: none; }
            .internal-ops-table tr:hover { background-color: #f3f4f6; }
            
            /* Team Workload Cards Unification */
            .member-workload-card { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.02); }
            .member-workload-header { background: #f9fafb; padding: 14px 20px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; transition: background-color 0.2s; }
            .member-workload-header:hover { background: #f3f4f6; }
            .member-workload-header h3 { margin: 0; font-size: 1.05rem; color: #111827; display: flex; align-items: center; font-weight: 600; }
            .toggle-icon { transition: transform 0.2s ease-in-out; margin-right: 8px; flex-shrink: 0; color: #6b7280; }
            
            /* Buttons & Badges */
            .internal-ops-actions { display: flex; gap: 8px; }
            .internal-ops-btn { padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; cursor: pointer; border: 1px solid #d1d5db; background: #fff; color: #374151; font-weight: 500; transition: all 0.2s; }
            .internal-ops-btn:hover { background: #f3f4f6; }
            .progress-badge { padding: 3px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: bold; }
        `;
        pageContainer.appendChild(style);

        const modalHtml = `
            <div id="internal-ops-team-workload-modal" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; justify-content: center; align-items: center;">
                <div style="background: #fff; padding: 24px; border-radius: 8px; width: 500px; max-width: 90%;">
                    <h3 id="tw-modal-title" style="margin-top: 0; margin-bottom: 16px;">新增任務</h3>
                    <form id="tw-modal-form" onsubmit="submitTeamWorkload(event)">
                        <input type="hidden" id="tw-workId" />
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">成員名稱 *</label>
                            <select id="tw-memberName" required style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;"></select>
                        </div>
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">任務標題 *</label>
                            <input type="text" id="tw-taskTitle" required style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                        </div>
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">任務類型</label>
                            <select id="tw-taskType" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;"></select>
                        </div>
                        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">狀態</label>
                                <select id="tw-status" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;">
                                    <option value="未開始">未開始</option>
                                    <option value="進行中">進行中</option>
                                    <option value="卡關">卡關</option>
                                    <option value="已完成">已完成</option>
                                </select>
                            </div>
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">進度 (%)</label>
                                <input type="number" id="tw-progress" min="0" max="100" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                            </div>
                        </div>
                        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">開始日期</label>
                                <input type="date" id="tw-startDate" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                            </div>
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">預計截止日期</label>
                                <input type="date" id="tw-dueDate" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                            </div>
                        </div>
                        <div style="margin-bottom: 20px;">
                            <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">備註</label>
                            <textarea id="tw-notes" rows="2" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;"></textarea>
                        </div>
                        <div style="display: flex; justify-content: flex-end; gap: 10px;">
                            <button type="button" onclick="closeTeamWorkloadModal()" class="internal-ops-btn" style="padding: 8px 16px;">取消</button>
                            <button type="submit" class="action-btn primary" style="padding: 8px 16px; border: none; background: #1976d2; color: #fff; border-radius: 4px; cursor: pointer;">儲存</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        pageContainer.insertAdjacentHTML('beforeend', modalHtml);

        const devProjectModalHtml = `
            <div id="internal-ops-dev-project-modal" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; justify-content: center; align-items: center;">
                <div style="background: #fff; padding: 24px; border-radius: 8px; width: 600px; max-width: 90%;">
                    <h3 id="dp-modal-title" style="margin-top: 0; margin-bottom: 16px;">新增開發案件</h3>
                    <form id="dp-modal-form" onsubmit="submitDevProject(event)">
                        <input type="hidden" id="dp-devId" />
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">商品名稱 *</label>
                            <input type="text" id="dp-productName" required style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                        </div>
                        <div style="margin-bottom: 12px;">
                            <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">商機案件 *</label>
                            <input type="text" id="dp-projectName" required style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                        </div>
                        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">功能項目</label>
                                <input type="text" id="dp-featureName" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                            </div>
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">協作成員</label>
                                <input type="text" id="dp-collaborators" placeholder="用｜分隔" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                            </div>
                        </div>
                        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">負責人</label>
                                <select id="dp-assigneeName" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;"></select>
                            </div>
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">開發階段</label>
                                <select id="dp-devStage" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;"></select>
                            </div>
                        </div>
                        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">狀態</label>
                                <select id="dp-status" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;">
                                    <option value="未開始">未開始</option>
                                    <option value="進行中">進行中</option>
                                    <option value="卡關">卡關</option>
                                    <option value="已完成">已完成</option>
                                    <option value="暫停">暫停</option>
                                </select>
                            </div>
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">進度 (%)</label>
                                <input type="number" id="dp-progress" min="0" max="100" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                            </div>
                        </div>
                        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">開始日期</label>
                                <input type="date" id="dp-startDate" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                            </div>
                            <div style="flex: 1;">
                                <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">預計完成日</label>
                                <input type="date" id="dp-estCompletionDate" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;" />
                            </div>
                        </div>
                        <div style="margin-bottom: 20px;">
                            <label style="display:block; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600;">備註</label>
                            <textarea id="dp-notes" rows="2" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;"></textarea>
                        </div>
                        <div style="display: flex; justify-content: flex-end; gap: 10px;">
                            <button type="button" onclick="closeDevProjectModal()" class="internal-ops-btn" style="padding: 8px 16px;">取消</button>
                            <button type="submit" class="action-btn primary" style="padding: 8px 16px; border: none; background: #1976d2; color: #fff; border-radius: 4px; cursor: pointer;">儲存</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        pageContainer.insertAdjacentHTML('beforeend', devProjectModalHtml);
    }

    if (!window.__systemConfig) {
        try {
            const configRes = await (typeof authedFetch === 'function' ? authedFetch('/api/config') : fetch('/api/config').then(r => r.json()));
            window.__systemConfig = configRes || {};
        } catch (err) {
            console.error('[Internal Ops] Failed to fetch system config:', err);
            window.__systemConfig = {};
        }
    }

    await Promise.all([
        fetchAndRenderSection('/api/internal-ops/dev-projects', renderTeamWorkload, 'internal-ops-team-workload-content'),
        fetchAndRenderSection('/api/internal-ops/dev-projects', renderDevProjects, 'internal-ops-dev-projects-content'),
        fetchAndRenderSection('/api/internal-ops/subscription-ops', renderSubscriptions, 'internal-ops-subscriptions-content')
    ]);
};

async function fetchAndRenderSection(endpoint, renderFn, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '<div class="loading show" style="padding: 20px;"><div class="spinner"></div><p style="text-align: center; margin-top: 10px;">載入中...</p></div>';
    
    try {
        const res = await (typeof authedFetch === 'function' ? authedFetch(endpoint) : fetch(endpoint).then(r => r.json()));
        const dataArray = Array.isArray(res) ? res : (res && res.success ? res.data : null);
        
        if (dataArray) {
            if (dataArray.length > 0) {
                container.innerHTML = renderFn(dataArray);
            } else {
                container.innerHTML = '<p style="padding: 30px; color: #888; text-align: center;">目前沒有資料</p>';
            }
        } else {
            container.innerHTML = '<p style="padding: 30px; color: #d32f2f; text-align: center;">載入失敗: ' + (res && res.error ? res.error : '無效的資料格式或未知的錯誤') + '</p>';
        }
    } catch (err) {
        console.error(`[Internal Ops] Fetch error for ${endpoint}:`, err);
        container.innerHTML = '<p style="padding: 30px; color: #d32f2f; text-align: center;">發生錯誤：' + err.message + '</p>';
    }
}

/**
 * 渲染：團隊成員負荷
 */
function renderTeamWorkload(data) {
    window.__internalOpsTeamWorkloadData = data; 
    
    if (!data || data.length === 0) return '';

    function getConfigColor(type, text, fallbackHex) {
        if (!text || text === '-') return buildColorSet(fallbackHex);
        const list = window.__systemConfig[type] || [];
        const item = list.find(i => i.note === text || i.value === text);
        if (item && item.style) {
            return buildColorSet(item.style);
        }
        return buildColorSet(fallbackHex);
    }

    function getBadgeHtml(text, colorSet) {
        if (!text || text === '-') return '-';
        return `<span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:0.75rem; font-weight:600; background:${colorSet.bgLight}; color:${colorSet.text}; border: 1px solid ${colorSet.border};">${text}</span>`;
    }

    function getRoleBadge(role) {
        let fallbackHex = role === '主負責人' ? '#1976d2' : '#616161';
        const colorSet = getConfigColor('擔當角色', role, fallbackHex);
        return getBadgeHtml(role, colorSet);
    }

    function getStatusBadge(status) {
        let fallbackHex = '#616161';
        switch(status) {
            case '進行中': fallbackHex = '#1976d2'; break;
            case '卡關': fallbackHex = '#c62828'; break;
            case '已完成': fallbackHex = '#2e7d32'; break;
            case '暫停': fallbackHex = '#f9a825'; break;
        }
        const colorSet = getConfigColor('開發狀態', status, fallbackHex);
        return getBadgeHtml(status, colorSet);
    }

    function getStageBadge(stage) {
        let fallbackHex = '#616161';
        switch(stage) {
            case '開發中': fallbackHex = '#1976d2'; break;
            case '測試中': fallbackHex = '#6a1b9a'; break;
            case '已上線': fallbackHex = '#2e7d32'; break;
        }
        const colorSet = getConfigColor('開發階段', stage, fallbackHex);
        return getBadgeHtml(stage, colorSet);
    }

    const groups = {};

    data.forEach(item => {
        const main = (item.assigneeName || '未指派').trim();
        if (!groups[main]) groups[main] = { main: 0, collab: 0, tasks: [] };
        groups[main].main++;
        groups[main].tasks.push({ ...item, _role: '主負責人' });

        if (item.collaborators) {
            const parts = String(item.collaborators).split('｜');
            parts.forEach(name => {
                const n = name.trim();
                if (!n) return;
                if (item.assigneeName && n === item.assigneeName.trim()) return;

                if (!groups[n]) groups[n] = { main: 0, collab: 0, tasks: [] };
                groups[n].collab++;
                groups[n].tasks.push({ ...item, _role: '協作者' });
            });
        }
    });

    const memberNames = Object.keys(groups).sort();
    
    let html = '<div class="team-workload-groups" style="display: flex; flex-direction: column; gap: 24px;">';
    const toggleIcon = `<svg class="toggle-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

    memberNames.forEach(member => {
        const groupData = groups[member];
        const tasks = groupData.tasks;
        
        tasks.sort((a, b) => {
            if (a._role !== b._role) {
                return a._role === '主負責人' ? -1 : 1;
            }
            if (!a.estCompletionDate) return 1;
            if (!b.estCompletionDate) return -1;
            return new Date(a.estCompletionDate) - new Date(b.estCompletionDate);
        });

        const rows = tasks.map((item, index) => `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${item.productName || item.projectName || '-'}</strong></td>
                <td>${getStageBadge(item.devStage || '-')}</td>
                <td>${getRoleBadge(item._role)}</td>
                <td>${getStatusBadge(item.status || '-')}</td>
            </tr>
        `).join('');

        const totalTasks = groupData.main + groupData.collab;
        const maxCapacity = 6;
        const workloadPercent = Math.min(Math.max((totalTasks / maxCapacity) * 100, 0), 100).toFixed(0);
        
        let barHex;
        if (totalTasks >= 6) {
            barHex = '#c62828'; 
        } else if (totalTasks >= 3) {
            barHex = '#f9a825'; 
        } else {
            barHex = '#2e7d32'; 
        }

        const workloadBarHtml = `
            <div style="display: flex; align-items: center; gap: 8px; margin-left: 8px; font-size: 0.85rem; font-weight: normal;">
                <div style="width: 80px; height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; display: flex;">
                    <div style="width: ${workloadPercent}%; height: 100%; background: ${barHex}; transition: width 0.3s ease;"></div>
                </div>
                <span style="color: ${barHex}; font-weight: 600;">${workloadPercent}%</span>
                <span style="color: #6b7280; margin-left: 4px; font-size: 0.8rem;">主 ${groupData.main} / 協 ${groupData.collab} / 共 ${totalTasks}</span>
            </div>
        `;

        html += `
            <div class="member-workload-card">
                <div class="member-workload-header" onclick="window.toggleWorkload(this)">
                    <h3 style="display: flex; align-items: center; margin: 0; font-size: 1.05rem; color: #111827; font-weight: 600; flex-wrap: wrap;">
                        ${toggleIcon}
                        <span>${member}</span>
                        ${workloadBarHtml}
                    </h3>
                </div>
                <div class="member-workload-body" style="display: none;">
                    <div style="overflow-x: auto;">
                        <table class="internal-ops-table" style="margin: 0; border-top: none;">
                            <thead>
                                <tr>
                                    <th style="width: 50px;">#</th>
                                    <th>商品名稱</th>
                                    <th>開發階段</th>
                                    <th>擔當角色</th>
                                    <th>狀態</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

window.toggleWorkload = function(headerElement) {
    const body = headerElement.nextElementSibling;
    const icon = headerElement.querySelector('.toggle-icon');
    if (body.style.display === 'none') {
        body.style.display = 'block';
        if (icon) icon.style.transform = 'rotate(90deg)';
    } else {
        body.style.display = 'none';
        if (icon) icon.style.transform = 'rotate(0deg)';
    }
};

// [Task 3, 4] 展開操作選單的邏輯
window.toggleDevActions = function(btnElement) {
    const panel = btnElement.nextElementSibling;
    const icon = btnElement.querySelector('.action-toggle-icon');
    if (panel.style.display === 'none') {
        panel.style.display = 'flex';
        if (icon) icon.style.transform = 'rotate(90deg)';
    } else {
        panel.style.display = 'none';
        if (icon) icon.style.transform = 'rotate(0deg)';
    }
};

/**
 * 渲染：開發案件追蹤
 */
function renderDevProjects(data) {
    window.__internalOpsDevProjectsData = data; 

    function getConfigColor(type, text, fallbackHex) {
        if (!text || text === '-') return buildColorSet(fallbackHex);
        const list = window.__systemConfig[type] || [];
        const item = list.find(i => i.note === text || i.value === text);
        if (item && item.style) {
            return buildColorSet(item.style);
        }
        return buildColorSet(fallbackHex);
    }

    function getBadgeHtml(text, colorSet) {
        if (!text || text === '-') return '-';
        return `<span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:0.75rem; font-weight:600; background:${colorSet.bgLight}; color:${colorSet.text}; border: 1px solid ${colorSet.border};">${text}</span>`;
    }

    function getStatusBadge(status) {
        let fallbackHex = '#616161';
        switch(status) {
            case '進行中': fallbackHex = '#1976d2'; break;
            case '卡關': fallbackHex = '#c62828'; break;
            case '已完成': fallbackHex = '#2e7d32'; break;
            case '暫停': fallbackHex = '#f9a825'; break;
        }
        const colorSet = getConfigColor('開發狀態', status, fallbackHex);
        return getBadgeHtml(status, colorSet);
    }

    function getStageBadge(stage) {
        let fallbackHex = '#616161';
        switch(stage) {
            case '開發中': fallbackHex = '#1976d2'; break;
            case '測試中': fallbackHex = '#6a1b9a'; break;
            case '已上線': fallbackHex = '#2e7d32'; break;
        }
        const colorSet = getConfigColor('開發階段', stage, fallbackHex);
        return getBadgeHtml(stage, colorSet);
    }

    // [Task 2] 將實際與理論進度整併為雙層緊湊佈局
    function getCombinedProgressHtml(actualProgressText, startDate, estDate) {
        // Actual Progress
        if (!actualProgressText) actualProgressText = '0%';
        const aVal = parseInt(actualProgressText.replace('%', ''), 10) || 0;
        const clampedAVal = Math.min(Math.max(aVal, 0), 100);
        let aHex;
        if (aVal < 30) aHex = '#616161';
        else if (aVal > 70) aHex = '#2e7d32';
        else aHex = '#1976d2';
        const aColor = buildColorSet(aHex);

        const actualHtml = `
            <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
                <span style="font-size: 0.75rem; color: #6b7280; min-width: 24px;">實際</span>
                <div style="flex: 1; height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden;">
                    <div style="width: ${clampedAVal}%; height: 100%; background: ${aColor.text};"></div>
                </div>
                <span style="background:${aColor.bgLight}; color:${aColor.text}; border: 1px solid ${aColor.border}; padding: 2px 6px; border-radius: 10px; font-size: 0.7rem; font-weight: 600; min-width: 36px; text-align: center;">${actualProgressText}</span>
            </div>
        `;

        // Theoretical Progress
        let tHtml = '';
        if (startDate && estDate) {
            const start = new Date(startDate).setHours(0,0,0,0);
            const end = new Date(estDate).setHours(23,59,59,999);
            const now = new Date().setHours(0,0,0,0);

            if (!isNaN(start) && !isNaN(end) && start < end) {
                let tProg = 0;
                if (now >= end) tProg = 100;
                else if (now > start) tProg = Math.round(((now - start) / (end - start)) * 100);
                
                const clampedTVal = Math.min(Math.max(tProg, 0), 100);
                
                let cueHtml = '';
                const diff = aVal - tProg;
                if (diff <= -10) cueHtml = `<span style="color:#c62828; font-size:0.7rem; margin-left:4px; font-weight: bold; white-space: nowrap;">(落後)</span>`;
                else if (diff >= 10) cueHtml = `<span style="color:#2e7d32; font-size:0.7rem; margin-left:4px; font-weight: bold; white-space: nowrap;">(超前)</span>`;

                tHtml = `
                    <div style="display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 6px;">
                        <span style="font-size: 0.75rem; color: #6b7280; min-width: 24px;">理論</span>
                        <div style="flex: 1; height: 6px; background: #f3f4f6; border: 1px dashed #d1d5db; border-radius: 3px; overflow: hidden;">
                            <div style="width: ${clampedTVal}%; height: 100%; background: #9ca3af;"></div>
                        </div>
                        <div style="display: flex; align-items: center; min-width: 36px; justify-content: flex-end;">
                            <span style="color: #6b7280; font-size: 0.7rem; font-weight: 600;">${tProg}%</span>
                            ${cueHtml}
                        </div>
                    </div>
                `;
            } else {
                tHtml = `<div style="display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 6px;"><span style="font-size: 0.75rem; color: #6b7280; min-width: 24px;">理論</span><span style="font-size: 0.75rem; color: #9ca3af;">-</span></div>`;
            }
        } else {
             tHtml = `<div style="display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 6px;"><span style="font-size: 0.75rem; color: #6b7280; min-width: 24px;">理論</span><span style="font-size: 0.75rem; color: #9ca3af;">-</span></div>`;
        }

        return `<div style="display: flex; flex-direction: column; min-width: 160px; max-width: 250px;">${actualHtml}${tHtml}</div>`;
    }

    // [Task 1, 3] 重排欄位，並將按鈕轉換為展開選單
    const rows = data.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${item.productName || '-'}</td>
            <td><strong>${item.projectName || '-'}</strong></td>
            <td>${item.featureName || '-'}</td>
            <td>${item.assigneeName || '-'}</td>
            <td>${item.collaborators || '-'}</td>
            <td>${getStageBadge(item.devStage || '-')}</td>
            <td>${getStatusBadge(item.status || '-')}</td>
            <td>${item.startDate || '-'}</td>
            <td>${item.estCompletionDate || '-'}</td>
            <td>${getCombinedProgressHtml(item.progress, item.startDate, item.estCompletionDate)}</td>
            <td style="vertical-align: top;">
                <div style="display: flex; flex-direction: column; align-items: flex-start;">
                    <button class="internal-ops-btn" style="padding: 2px 6px; display: flex; align-items: center; gap: 4px; border: none; background: transparent; color: #6b7280; box-shadow: none;" onclick="window.toggleDevActions(this)">
                        <svg class="action-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transition: transform 0.2s"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        操作
                    </button>
                    <div class="dev-actions-panel" style="display: none; flex-direction: column; gap: 6px; margin-top: 8px; padding-left: 4px;">
                        <button class="internal-ops-btn" style="display: flex; align-items: center; gap: 6px; width: 100%; justify-content: flex-start; padding: 4px 8px;" onclick="openDevProjectModal('${item.devId}')">✏️ 編輯</button>
                        <button class="internal-ops-btn" style="display: flex; align-items: center; gap: 6px; width: 100%; justify-content: flex-start; color: #c62828; padding: 4px 8px;" onclick="deleteDevProject('${item.devId}')">🗑️ 刪除</button>
                    </div>
                </div>
            </td>
        </tr>
    `).join('');

    return `
        <table class="internal-ops-table">
            <thead>
                <tr>
                    <th style="width: 50px;">#</th>
                    <th>商品名稱</th>
                    <th>商機案件</th>
                    <th>功能項目</th>
                    <th>負責人</th>
                    <th>協作成員</th>
                    <th>開發階段</th>
                    <th>狀態</th>
                    <th>開始日</th>
                    <th>預計完成日</th>
                    <th>進度</th>
                    <th style="min-width: 80px;">操作</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

/**
 * 渲染：訂閱制管理
 */
function renderSubscriptions(data) {
    const rows = data.map(item => `
        <tr>
            <td><strong>${item.customerName || '-'}</strong></td>
            <td>${item.companyName || '-'}</td>
            <td>${item.productName || '-'}</td>
            <td>${item.planName || '-'}</td>
            <td>${item.assigneeName || '-'}</td>
            <td>${item.subStatus || '-'}</td>
            <td>${item.renewalDate || '-'}</td>
            <td>${item.nextActionDate || '-'}</td>
            <td>${item.msgStatus || '-'}</td>
            <td>${item.emailStatus || '-'}</td>
            <td>
                <div class="internal-ops-actions">
                    <button class="internal-ops-btn" onclick="alert('TODO: 編輯訂閱 ${item.subId}')">編輯</button>
                    <button class="internal-ops-btn" onclick="alert('TODO: 刪除訂閱 ${item.subId}')" style="color: #d32f2f;">刪除</button>
                </div>
            </td>
        </tr>
    `).join('');

    return `
        <table class="internal-ops-table">
            <thead>
                <tr>
                    <th>客戶名稱</th>
                    <th>公司名稱</th>
                    <th>商品名稱</th>
                    <th>方案名稱</th>
                    <th>負責人</th>
                    <th>訂閱狀態</th>
                    <th>續約日期</th>
                    <th>下次行動</th>
                    <th>訊息狀態</th>
                    <th>Email狀態</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

// ==========================================
// Dev Projects CRUD Helper Functions
// ==========================================

function populateDevProjectDropdowns() {
    const assigneeSelect = document.getElementById('dp-assigneeName');
    const devStageSelect = document.getElementById('dp-devStage');

    // Always fetch fresh config
    return (typeof authedFetch === 'function'
        ? authedFetch('/api/config')
        : fetch('/api/config').then(r => r.json()))
        .then(config => {
            const members = (config && config['團隊成員']) ? config['團隊成員'] : [];

            if (members.length > 0) {
                assigneeSelect.innerHTML = members.map(m =>
                    `<option value="${m.value}">${m.note}</option>`
                ).join('');
                assigneeSelect.value = members[0].value;
            } else {
                assigneeSelect.innerHTML = '<option value="">(無可用成員)</option>';
            }

            const stages = (config && config['開發階段']) ? config['開發階段'] : [];
            if (stages.length > 0) {
                devStageSelect.innerHTML = stages.map(s =>
                    `<option value="${s.value}">${s.note}</option>`
                ).join('');
                devStageSelect.value = stages[0].value;
            } else {
                const fallbackStages = ['規劃中', '開發中', '測試中', '已上線'];
                devStageSelect.innerHTML = fallbackStages.map(s =>
                    `<option value="${s}">${s}</option>`
                ).join('');
            }
        })
        .catch(err => {
            console.error('[Internal Ops] config load error:', err);
            assigneeSelect.innerHTML = '<option value="">(載入失敗)</option>';
            devStageSelect.innerHTML = '<option value="">(載入失敗)</option>';
        });
}

window.openDevProjectModal = function(devId = null) {
    const form = document.getElementById('dp-modal-form');
    form.reset();
    document.getElementById('dp-devId').value = '';
    document.getElementById('dp-modal-title').textContent = '新增開發案件';

    const dropdownPromise = populateDevProjectDropdowns();

    // Set default start date to today
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    document.getElementById('dp-startDate').value = today;

    if (devId && window.__internalOpsDevProjectsData) {
        const item = window.__internalOpsDevProjectsData.find(data => data.devId === devId);
        if (item) {
            document.getElementById('dp-modal-title').textContent = '編輯開發案件';
            document.getElementById('dp-devId').value = item.devId;
            
            dropdownPromise.then(() => {
                const assigneeSelect = document.getElementById('dp-assigneeName');
                if (item.assigneeName) {
                    const option = Array.from(assigneeSelect.options)
                        .find(opt => opt.value === item.assigneeName || opt.text === item.assigneeName);
                    if (option) assigneeSelect.value = option.value;
                }

                const devStageSelect = document.getElementById('dp-devStage');
                if (item.devStage) {
                    const option = Array.from(devStageSelect.options)
                        .find(opt => opt.value === item.devStage || opt.text === item.devStage);
                    if (option) devStageSelect.value = option.value;
                }
            });
            
            document.getElementById('dp-productName').value = item.productName || '';
            document.getElementById('dp-projectName').value = item.projectName || '';
            document.getElementById('dp-featureName').value = item.featureName || '';
            document.getElementById('dp-collaborators').value = item.collaborators || '';
            document.getElementById('dp-status').value = item.status || '未開始';
            document.getElementById('dp-progress').value = (item.progress || '').replace('%', '');
            document.getElementById('dp-startDate').value = item.startDate || '';
            document.getElementById('dp-estCompletionDate').value = item.estCompletionDate || '';
            document.getElementById('dp-notes').value = item.notes || '';
        }
    }

    document.getElementById('internal-ops-dev-project-modal').style.display = 'flex';
};

window.closeDevProjectModal = function() {
    document.getElementById('internal-ops-dev-project-modal').style.display = 'none';
};

window.submitDevProject = async function(event) {
    event.preventDefault();
    
    const devId = document.getElementById('dp-devId').value;
    const progressRaw = document.getElementById('dp-progress').value;
    
    const data = {
        productCode: '', // 預留
        productName: document.getElementById('dp-productName').value,
        projectName: document.getElementById('dp-projectName').value,
        featureName: document.getElementById('dp-featureName').value,
        assigneeCode: '', // 預留
        assigneeName: document.getElementById('dp-assigneeName').value,
        collaborators: document.getElementById('dp-collaborators').value,
        devStage: document.getElementById('dp-devStage').value,
        status: document.getElementById('dp-status').value,
        progress: progressRaw ? progressRaw + '%' : '',
        priority: '', // 預留
        startDate: document.getElementById('dp-startDate').value,
        estCompletionDate: document.getElementById('dp-estCompletionDate').value,
        actualCompletionDate: '', // 預留
        dependencies: '', // dependency (backend property is 'dependencies')
        notes: document.getElementById('dp-notes').value,
        isActive: true, // 預留
        sortOrder: 999 // 預留
    };

    const method = devId ? 'PUT' : 'POST';
    const url = devId ? `/api/internal-ops/dev-projects/${devId}` : '/api/internal-ops/dev-projects';

    try {
        let res;
        if (typeof authedFetch === 'function') {
            res = await authedFetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).then(r => r.json());
        }

        if (res && res.success !== false && !res.error) {
            closeDevProjectModal();
            fetchAndRenderSection('/api/internal-ops/dev-projects', renderDevProjects, 'internal-ops-dev-projects-content');
            // Simultaneously update the Team Workload projection
            fetchAndRenderSection('/api/internal-ops/dev-projects', renderTeamWorkload, 'internal-ops-team-workload-content');
        } else {
            alert('儲存失敗: ' + (res.error || '未知錯誤'));
        }
    } catch (e) {
        console.error(e);
        alert('儲存發生錯誤: ' + e.message);
    }
};

window.deleteDevProject = async function(devId) {
    if (!confirm('確定要刪除這筆開發案件嗎？')) return;
    
    try {
        const url = `/api/internal-ops/dev-projects/${devId}`;
        let res;
        
        if (typeof authedFetch === 'function') {
            res = await authedFetch(url, { method: 'DELETE' });
        } else {
            res = await fetch(url, { method: 'DELETE' }).then(r => r.json());
        }
        
        if (res && res.success !== false && !res.error) {
            fetchAndRenderSection('/api/internal-ops/dev-projects', renderDevProjects, 'internal-ops-dev-projects-content');
            // Simultaneously update the Team Workload projection
            fetchAndRenderSection('/api/internal-ops/dev-projects', renderTeamWorkload, 'internal-ops-team-workload-content');
        } else {
            alert('刪除失敗: ' + (res.error || '未知錯誤'));
        }
    } catch (e) {
        console.error(e);
        alert('刪除發生錯誤: ' + e.message);
    }
};

// ==========================================
// Team Workload CRUD Helper Functions
// (Retained for legacy/future compatibility per instruction)
// ==========================================

function populateTeamWorkloadDropdowns() {
    const memberSelect = document.getElementById('tw-memberName');
    const taskTypeSelect = document.getElementById('tw-taskType');

    // Always fetch fresh config (avoid stale or empty cache)
    return (typeof authedFetch === 'function'
        ? authedFetch('/api/config')
        : fetch('/api/config').then(r => r.json()))
        .then(config => {

            // --- Team Members (simple, no filtering) ---
            const members = (config && config['團隊成員']) ? config['團隊成員'] : [];

            if (members.length > 0) {
                memberSelect.innerHTML = members.map(m =>
                    `<option value="${m.value}">${m.note}</option>`
                ).join('');
                if (members.length > 0) {
                    memberSelect.value = members[0].value;
                }
            } else {
                memberSelect.innerHTML = '<option value="">(無可用成員)</option>';
            }

            // --- Task Types ---
            const taskTypes = (config && config['任務類型']) ? config['任務類型'] : [];

            if (taskTypes.length > 0) {
                taskTypeSelect.innerHTML = taskTypes.map(t =>
                    `<option value="${t.value}">${t.note}</option>`
                ).join('');
            } else {
                const fallback = ['開發', '測試', '設計', '維運'];
                taskTypeSelect.innerHTML = fallback.map(t =>
                    `<option value="${t}">${t}</option>`
                ).join('');
            }

        })
        .catch(err => {
            console.error('[Internal Ops] config load error:', err);
            memberSelect.innerHTML = '<option value="">(載入失敗)</option>';
        });
}

window.openTeamWorkloadModal = function(workId = null) {
    const form = document.getElementById('tw-modal-form');
    form.reset();
    document.getElementById('tw-workId').value = '';
    document.getElementById('tw-modal-title').textContent = '新增任務';

    const dropdownPromise = populateTeamWorkloadDropdowns();

    // Set default start date to today
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    document.getElementById('tw-startDate').value = today;

    if (workId && window.__internalOpsTeamWorkloadData) {
        const item = window.__internalOpsTeamWorkloadData.find(data => data.workId === workId);
        if (item) {
            document.getElementById('tw-modal-title').textContent = '編輯任務';
            document.getElementById('tw-workId').value = item.workId;
            
            dropdownPromise.then(() => {
                const memberSelect = document.getElementById('tw-memberName');
                const taskTypeSelect = document.getElementById('tw-taskType');

                // Safe selection: find matching option by text or value
                if (item.memberName) {
                    const option = Array.from(memberSelect.options)
                        .find(opt => opt.value === item.memberName || opt.text === item.memberName);
                    if (option) memberSelect.value = option.value;
                }

                if (item.taskType) {
                    const option = Array.from(taskTypeSelect.options)
                        .find(opt => opt.value === item.taskType || opt.text === item.taskType);
                    if (option) taskTypeSelect.value = option.value;
                }
            });
            
            document.getElementById('tw-taskTitle').value = item.taskTitle || '';
            
            document.getElementById('tw-status').value = item.status || '未開始';
            document.getElementById('tw-progress').value = (item.progress || '').replace('%', '');
            document.getElementById('tw-startDate').value = item.startDate || '';
            document.getElementById('tw-dueDate').value = item.dueDate || '';
            document.getElementById('tw-notes').value = item.notes || '';
        }
    }

    document.getElementById('internal-ops-team-workload-modal').style.display = 'flex';
};

window.closeTeamWorkloadModal = function() {
    document.getElementById('internal-ops-team-workload-modal').style.display = 'none';
};

window.submitTeamWorkload = async function(event) {
    event.preventDefault();
    
    const workId = document.getElementById('tw-workId').value;
    const progressRaw = document.getElementById('tw-progress').value;
    
    const data = {
        memberName: document.getElementById('tw-memberName').value,
        taskTitle: document.getElementById('tw-taskTitle').value,
        taskType: document.getElementById('tw-taskType').value,
        status: document.getElementById('tw-status').value,
        progress: progressRaw ? progressRaw + '%' : '',
        startDate: document.getElementById('tw-startDate').value,
        dueDate: document.getElementById('tw-dueDate').value,
        notes: document.getElementById('tw-notes').value
    };

    const method = workId ? 'PUT' : 'POST';
    const url = workId ? `/api/internal-ops/team-workload/${workId}` : '/api/internal-ops/team-workload';

    try {
        let res;
        if (typeof authedFetch === 'function') {
            res = await authedFetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            }).then(r => r.json());
        }

        if (res && res.success !== false && !res.error) { // 寬鬆處理，支援不同 success 形狀
            closeTeamWorkloadModal();
            fetchAndRenderSection('/api/internal-ops/team-workload', renderTeamWorkload, 'internal-ops-team-workload-content');
        } else {
            alert('儲存失敗: ' + (res.error || '未知錯誤'));
        }
    } catch (e) {
        console.error(e);
        alert('儲存發生錯誤: ' + e.message);
    }
};

window.deleteTeamWorkload = async function(workId) {
    if (!confirm('確定要刪除這筆工作紀錄嗎？')) return;
    
    try {
        const url = `/api/internal-ops/team-workload/${workId}`;
        let res;
        
        if (typeof authedFetch === 'function') {
            res = await authedFetch(url, { method: 'DELETE' });
        } else {
            res = await fetch(url, { method: 'DELETE' }).then(r => r.json());
        }
        
        if (res && res.success !== false && !res.error) {
            fetchAndRenderSection('/api/internal-ops/team-workload', renderTeamWorkload, 'internal-ops-team-workload-content');
        } else {
            alert('刪除失敗: ' + (res.error || '未知錯誤'));
        }
    } catch (e) {
        console.error(e);
        alert('刪除發生錯誤: ' + e.message);
    }
};
// public/scripts/internal-ops/internal-ops.js
/**
 * public/scripts/internal-ops/internal-ops.js
 * 內部運營與進度追蹤 前端模組 (Phase 4.8)
 * @version 1.7.3
 * @date 2026-04-21
 * @changelog
 * - [1.7.3] UI Patch (Step 3): Added collapsible behavior to Team Workload member groups to improve readability. Default state is collapsed.
 * - [1.7.2] UI Patch (Step 2): Unified visual language, headers, spacing, and table/card tones across all three sections.
 * - [1.7.1] UI Patch (Step 1): Added compact visual progress bar to Dev Projects table for better at-a-glance readability.
 * - [1.7.0] Normalized Color System - Implemented single-source color strategy with derived opacity for badges
 * - [1.6.0] Externalized color system for badges (Role, Stage, Status, Workload) to System Config and added index column to Dev Projects table
 * - [1.5.0] Upgraded Team Workload table UI readability with index column and color badges
 * - [1.4.0] Added workload level indicator badge (Green/Yellow/Red) based on main task count
 * - [1.3.0] Upgraded Team Workload to Participation View and reordered sections (Dev Projects first)
 * - [1.2.3] Enhanced Team Workload metrics to display main, collab, and total counts
 * - [1.2.2] Upgraded Input Model for Dev Projects (added startDate, collaborators, devStage dropdown, and renamed UI labels)
 * - [1.2.1] Changed Team Workload data source to dev-projects and updated grouping logic
 * - [1.2.0] Implemented CRUD UI and logic for Dev Projects section
 * - [1.1.0] Converted Team Workload section to a grouped read-only view and removed UI entry points for CRUD
 * - [1.0.14] Ensured default selection for dropdown in create mode
 * - [1.0.13] Fixed dropdown selection mismatch issue by finding matching option by text or value
 * - [1.0.12] Fixed async timing issue when setting dropdown values by returning promise from population function
 * - [1.0.11] Fixed unauthenticated fetch call for system config in dropdown population
 * - [1.0.10] Switched to direct API fetch for dropdown config to bypass stale cache issues and removed frontend filtering
 * - [1.0.9] Fixed boolean/string check for enabled status in team member dropdown
 * - [1.0.8] Fixed boolean check for enabled status in team member dropdown
 * - [1.0.7] Added enabled filter for team members
 * - [1.0.6] Fixed dropdown data source logic to handle grouped config object correctly
 * - [1.0.5] Fixed system config assignment to retain grouped object structure
 * - [1.0.4] Fixed System Config API path and hardened team member filter logic
 * - [1.0.3] Integrated System Config for dropdowns (memberName, taskType), default date, and UI tweaks
 * - [1.0.2] Added CRUD UI and logic for Team Workload section
 * - [1.0.1] Fixed API response parsing to support both plain array and { success, data } formats
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

    // 1. 建立頁面骨架 (若尚未建立)
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

        // 加入 Team Workload Modal DOM (保留，即便目前入口隱藏，避免破壞潛在依賴)
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

        // 加入 Dev Projects Modal DOM
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

    // 2. 獲取系統設定 (System Config) 以供下拉選單使用
    if (!window.__systemConfig) {
        try {
            const configRes = await (typeof authedFetch === 'function' ? authedFetch('/api/config') : fetch('/api/config').then(r => r.json()));
            window.__systemConfig = configRes || {};
        } catch (err) {
            console.error('[Internal Ops] Failed to fetch system config:', err);
            window.__systemConfig = {};
        }
    }

    // 3. 載入資料並渲染 (並行請求)
    await Promise.all([
        fetchAndRenderSection('/api/internal-ops/dev-projects', renderTeamWorkload, 'internal-ops-team-workload-content'),
        fetchAndRenderSection('/api/internal-ops/dev-projects', renderDevProjects, 'internal-ops-dev-projects-content'),
        fetchAndRenderSection('/api/internal-ops/subscription-ops', renderSubscriptions, 'internal-ops-subscriptions-content')
    ]);
};

/**
 * 負責單一區塊的資料獲取與狀態處理
 */
async function fetchAndRenderSection(endpoint, renderFn, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Loading state
    container.innerHTML = '<div class="loading show" style="padding: 20px;"><div class="spinner"></div><p style="text-align: center; margin-top: 10px;">載入中...</p></div>';
    
    try {
        const res = await (typeof authedFetch === 'function' ? authedFetch(endpoint) : fetch(endpoint).then(r => r.json()));
        
        // 支援 plain array 或 { success: true, data: [...] } 兩種格式
        const dataArray = Array.isArray(res) ? res : (res && res.success ? res.data : null);
        
        if (dataArray) {
            if (dataArray.length > 0) {
                // Success state
                container.innerHTML = renderFn(dataArray);
            } else {
                // Empty state
                container.innerHTML = '<p style="padding: 30px; color: #888; text-align: center;">目前沒有資料</p>';
            }
        } else {
            // API Error state
            container.innerHTML = '<p style="padding: 30px; color: #d32f2f; text-align: center;">載入失敗: ' + (res && res.error ? res.error : '無效的資料格式或未知的錯誤') + '</p>';
        }
    } catch (err) {
        console.error(`[Internal Ops] Fetch error for ${endpoint}:`, err);
        // Network Error state
        container.innerHTML = '<p style="padding: 30px; color: #d32f2f; text-align: center;">發生錯誤：' + err.message + '</p>';
    }
}

/**
 * 渲染：團隊成員負荷 (成員參與視圖 - Read-Only Grouped View)
 */
function renderTeamWorkload(data) {
    window.__internalOpsTeamWorkloadData = data; // 保存資料供內部存取
    
    if (!data || data.length === 0) return '';

    // Helpers for config-driven styling
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

    function getProgressBadge(progressText) {
        if (!progressText) progressText = '0%';
        const val = parseInt(progressText.replace('%', ''), 10) || 0;
        let fallbackHex;
        if (val < 30) { fallbackHex = '#616161'; }
        else if (val > 70) { fallbackHex = '#2e7d32'; }
        else { fallbackHex = '#1976d2'; }
        const colorSet = buildColorSet(fallbackHex);
        return `<span class="progress-badge" style="background:${colorSet.bgLight}; color:${colorSet.text}; border: 1px solid ${colorSet.border}; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">${progressText}</span>`;
    }

    const groups = {};

    // 1. Gather all unique members and classify tasks
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

    // 2. Sort members
    const memberNames = Object.keys(groups).sort();
    
    let html = '<div class="team-workload-groups" style="display: flex; flex-direction: column; gap: 24px;">';
    
    // SVG toggle icon
    const toggleIcon = `<svg class="toggle-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

    memberNames.forEach(member => {
        const groupData = groups[member];
        const tasks = groupData.tasks;
        
        // Sort tasks: Main role first, then by estCompletionDate ascending
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
                <td><strong>${item.featureName || item.projectName || '-'}</strong></td>
                <td>${getStageBadge(item.devStage || '-')}</td>
                <td>${getRoleBadge(item._role)}</td>
                <td>${getStatusBadge(item.status || '-')}</td>
                <td>${getProgressBadge(item.progress)}</td>
                <td>${item.startDate || '-'}</td>
                <td>${item.estCompletionDate || '-'}</td>
            </tr>
        `).join('');

        const totalCount = groupData.main + groupData.collab;
        
        // Load indicator badge logic (based on main task count)
        const mainCount = groupData.main;
        let fallbackHex, loadText;
        if (mainCount >= 6) {
            fallbackHex = '#c62828'; loadText = '負荷高';
        } else if (mainCount >= 3) {
            fallbackHex = '#f9a825'; loadText = '負荷中';
        } else {
            fallbackHex = '#2e7d32'; loadText = '負荷低';
        }
        
        const colorSet = getConfigColor('負荷量表', loadText, fallbackHex);
        
        let badgeText = loadText;
        if (loadText === '負荷高') badgeText += '｜過載';
        else if (loadText === '負荷中') badgeText += '｜注意';
        else if (loadText === '負荷低') badgeText += '｜正常';

        const loadBadge = `<span style="display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.8rem; font-weight: 600; margin-left: 12px; background: ${colorSet.bgLight}; color: ${colorSet.text}; border: 1px solid ${colorSet.border};">${badgeText}</span>`;

        html += `
            <div class="member-workload-card">
                <div class="member-workload-header" onclick="window.toggleWorkload(this)">
                    <h3>
                        ${toggleIcon}
                        ${member} 
                        <span style="font-size: 0.9rem; color: #6b7280; font-weight: normal; margin-left: 8px;">（主責 ${groupData.main}｜協作 ${groupData.collab}｜總 ${totalCount}）</span>
                        ${loadBadge}
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
                                    <th>商品開發進度</th>
                                    <th>開始日</th>
                                    <th>預計完成日</th>
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

// [Task 5] 全域切換函數 (Minimal-diff toggle logic)
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

/**
 * 渲染：開發案件追蹤
 */
function renderDevProjects(data) {
    window.__internalOpsDevProjectsData = data; // 保存資料供編輯 modal 讀取

    // Helpers to utilize config colors for dev projects section as well
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

    // Compact visual progress bar
    function getProgressBadge(progressText) {
        if (!progressText) progressText = '0%';
        const val = parseInt(progressText.replace('%', ''), 10) || 0;
        const clampedVal = Math.min(Math.max(val, 0), 100);
        let fallbackHex;
        if (val < 30) { fallbackHex = '#616161'; }
        else if (val > 70) { fallbackHex = '#2e7d32'; }
        else { fallbackHex = '#1976d2'; }
        const colorSet = buildColorSet(fallbackHex);
        
        return `
            <div style="display: flex; align-items: center; gap: 8px; min-width: 120px;">
                <span class="progress-badge" style="background:${colorSet.bgLight}; color:${colorSet.text}; border: 1px solid ${colorSet.border}; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; min-width: 40px; text-align: center;">${progressText}</span>
                <div style="flex: 1; height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden;">
                    <div style="width: ${clampedVal}%; height: 100%; background: ${colorSet.text};"></div>
                </div>
            </div>
        `;
    }

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
            <td>${getProgressBadge(item.progress)}</td>
            <td>${item.estCompletionDate || '-'}</td>
            <td>${item.updateTime ? new Date(item.updateTime).toLocaleDateString() : '-'}</td>
            <td>
                <div class="internal-ops-actions">
                    <button class="internal-ops-btn" onclick="openDevProjectModal('${item.devId}')">編輯</button>
                    <button class="internal-ops-btn" onclick="deleteDevProject('${item.devId}')" style="color: #d32f2f;">刪除</button>
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
                    <th>進度</th>
                    <th>預計完成日</th>
                    <th>更新時間</th>
                    <th>操作</th>
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
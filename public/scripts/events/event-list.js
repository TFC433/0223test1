// public/scripts/events/event-list.js
// 職責：渲染並管理「事件紀錄」頁面的主列表 (含搜尋、篩選、統計、圖示化操作)
// (Systematic Refactor: Event Delegation - 統一事件處理機制)
/**
 * @version 1.0.6
 * @date 2026-03-16
 * @description [Layout Recovery] Rolled back to stable .dashboard-widget skeleton while retaining minimal Tab/CTA visual alignments.
 */

// 模組內部狀態
let _fullEventData = [];
let _eventFilters = { type: 'all', time: 'all', creator: 'all' };
let _eventSearchQuery = '';

// [Forensics Probe] Debug Counters
window._DEBUG_EVENT_LIST_BIND_COUNT ||= 0;
window._DEBUG_EVENT_LIST_CLICK_COUNT ||= 0;

/**
 * 初始化並渲染事件紀錄列表介面
 * @param {HTMLElement} container - 容器
 * @param {Array<object>} eventList - 資料來源
 */
function renderEventLogList(container, eventList) {
    if (!container) return;

    // 1. 儲存原始資料
    _fullEventData = eventList || [];

    // 2. 注入 CSS 樣式
    _injectEventListStyles();

    // 3. 渲染介面骨架 (包裹 root class 以便委派，恢復穩定 dashboard-widget 結構)
    container.innerHTML = `
        <div class="event-list-root dashboard-widget" style="margin-top: 24px;">
            
            <div class="widget-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <h2 class="widget-title" style="margin: 0; font-size: 1.25rem;">事件總覽</h2>
                <div class="crm-tabs" id="event-type-tabs">
                    </div>
            </div>

            <div class="search-pagination" style="padding: 1rem 1.5rem; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; border-bottom: 1px solid var(--border-color);">
                <input type="text" class="search-box" id="event-list-search" placeholder="搜尋事件、對象或建立者..." style="flex-grow: 1; min-width: 200px;">
                
                <div id="event-list-filters" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <select id="event-filter-time" class="form-select-sm">
                        <option value="all">所有時間</option>
                        <option value="7">近 7 天</option>
                        <option value="30">近 30 天</option>
                        <option value="90">近 90 天</option>
                    </select>
                    <select id="event-filter-creator" class="form-select-sm">
                        <option value="all">所有建立者</option>
                    </select>
                </div>

                <button class="action-btn primary" data-action="create-event" style="flex-shrink: 0;">
                    ＋ 新增紀錄
                </button>
            </div>

            <div id="event-list-count-container" style="text-align: right; padding: 0.75rem 1.5rem 0.5rem; font-size: 0.95rem; color: var(--text-muted); font-weight: 500;">
                共 0 筆
            </div>

            <div class="widget-content" style="padding: 0;">
                <div id="event-list-table-container" class="event-list-container">
                    <div class="loading show"><div class="spinner"></div></div>
                </div>
            </div>

        </div>
    `;

    // 4. 綁定事件委派
    const widgetRoot = container.querySelector('.event-list-root');
    if (widgetRoot) {
        window._DEBUG_EVENT_LIST_BIND_COUNT++;
        widgetRoot.removeEventListener('click', handleEventListClick);
        widgetRoot.addEventListener('click', handleEventListClick);
    }

    // 5. 初始化篩選選項 (包含產生 Tabs)
    _populateEventFilterOptions();

    // 6. 綁定輸入與 Select 事件
    const searchInput = document.getElementById('event-list-search');
    if (searchInput) {
        searchInput.addEventListener('keyup', (e) => {
            _eventSearchQuery = e.target.value.toLowerCase().trim();
            _filterAndRenderEvents();
        });
    }
    
    ['time', 'creator'].forEach(key => {
        const el = document.getElementById(`event-filter-${key}`);
        if (el) {
            el.addEventListener('change', (e) => {
                _eventFilters[key] = e.target.value;
                _filterAndRenderEvents();
            });
        }
    });

    // 7. 初始渲染表格
    _filterAndRenderEvents();
}

/**
 * 事件處理中心 (Delegation Hub)
 */
function handleEventListClick(e) {
    window._DEBUG_EVENT_LIST_CLICK_COUNT++;
    const btn = e.target.closest('[data-action]');

    if (!btn) return;

    const action = btn.dataset.action;
    const payload = btn.dataset;

    // 對於非導航類的按鈕，阻止預設行為
    if (action !== 'navigate') {
        e.preventDefault();
    }

    switch (action) {
        case 'filter-type':
            // 處理 Tab 切換
            _eventFilters.type = payload.value;
            document.querySelectorAll('#event-type-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _filterAndRenderEvents();
            break;

        case 'create-event':
            if (typeof window.showEventLogForCreation === 'function') {
                window.showEventLogForCreation();
            } else {
                console.warn('showEventLogForCreation function not found');
            }
            break;

        case 'view-report':
            if (typeof window.showEventLogReport === 'function') {
                window.showEventLogReport(payload.id);
            } else {
                console.warn('showEventLogReport function not found');
            }
            break;
            
        case 'edit-event':
             if (window.EventEditorStandalone && window.EventEditorStandalone.open) {
                window.EventEditorStandalone.open(payload.id);
            } else {
                console.warn('EventEditorStandalone module not found');
            }
            break;
            
        case 'delete-event':
             if (window.EventEditorStandalone && window.EventEditorStandalone.open) {
                window.EventEditorStandalone.open(payload.id);
            }
            break;

        case 'navigate':
            // 處理 SPA 導航
            if (payload.page) {
                e.preventDefault();
                const params = payload.params ? JSON.parse(payload.params) : {};
                if (window.CRM_APP && window.CRM_APP.navigateTo) {
                    window.CRM_APP.navigateTo(payload.page, params);
                }
            }
            break;
    }
}

/**
 * 核心邏輯：篩選資料並重新渲染表格
 */
function _filterAndRenderEvents() {
    const tableContainer = document.getElementById('event-list-table-container');
    const countDisplay = document.getElementById('event-list-count-container');
    if (!tableContainer) return;

    // --- 篩選邏輯 ---
    const now = Date.now();
    const timeMap = { '7': 7, '30': 30, '90': 90 };
    
    let filtered = _fullEventData.filter(evt => {
        // 1. 搜尋
        if (_eventSearchQuery) {
            const searchContent = `${evt.eventName} ${evt.opportunityName||''} ${evt.companyName||''} ${evt.creator}`.toLowerCase();
            if (!searchContent.includes(_eventSearchQuery)) return false;
        }

        // 2. 類型篩選 (Tabs)
        if (_eventFilters.type !== 'all' && evt.eventType !== _eventFilters.type) return false;

        // 3. 時間篩選
        if (_eventFilters.time !== 'all') {
            const days = timeMap[_eventFilters.time];
            const evtTime = new Date(evt.lastModifiedTime || evt.createdTime).getTime();
            if ((now - evtTime) > (days * 24 * 60 * 60 * 1000)) return false;
        }

        // 4. 建立者篩選
        if (_eventFilters.creator !== 'all' && evt.creator !== _eventFilters.creator) return false;

        return true;
    });

    // 更新統計 (單一區塊文字)
    if (countDisplay) countDisplay.textContent = `共 ${filtered.length} 筆`;

    // --- 渲染表格 ---
    if (filtered.length === 0) {
        tableContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">沒有符合條件的事件紀錄</div>';
        return;
    }

    const eventTypeConfig = new Map((window.CRM_APP?.systemConfig?.['事件類型'] || []).map(t => [t.value, { note: t.note, color: t.color }]));

    let html = `
        <table class="event-list-table">
            <thead>
                <tr>
                    <th class="col-idx">項次</th>
                    <th class="col-date">最後更新</th>
                    <th class="col-type">事件類型</th>
                    <th class="col-name">事件名稱</th>
                    <th class="col-obj-tag">關聯對象</th>
                    <th class="col-obj-name">對象名稱</th>
                    <th class="col-user">建立者</th>
                    <th class="col-actions">操作</th>
                </tr>
            </thead>
            <tbody>`;

    filtered.forEach((event, index) => {
        const typeInfo = eventTypeConfig.get(event.eventType) || { note: (event.eventType || 'unknown').toUpperCase(), color: '#9ca3af' };
        const typeHtml = `<span class="common-chip" style="background-color: ${typeInfo.color};">${typeInfo.note}</span>`;

        const displayTime = event.lastModifiedTime || event.createdTime;
        const dateStr = displayTime ? new Date(displayTime).toLocaleDateString('zh-TW') : '-';

        let objTagHtml = '<span style="color:#d1d5db;">-</span>';
        let objNameHtml = '<span style="color:#d1d5db;">-</span>';

        if (event.opportunityId) {
            objTagHtml = `<span class="common-chip" style="background-color: #3b82f6;">機會</span>`;
            const params = JSON.stringify({ opportunityId: event.opportunityId }).replace(/"/g, '&quot;');
            objNameHtml = `<a href="#" class="text-link text-truncate" title="${event.opportunityName || event.opportunityId}" 
                            data-action="navigate" 
                            data-page="opportunity-details" 
                            data-params="${params}">
                            ${event.opportunityName || '(未命名)'}
                           </a>`;
        } else if (event.companyName || event.companyId) {
            const cName = event.companyName || event.companyId;
            objTagHtml = `<span class="common-chip" style="background-color: #6b7280;">公司</span>`;
            const params = JSON.stringify({ companyName: encodeURIComponent(cName) }).replace(/"/g, '&quot;');
            objNameHtml = `<a href="#" class="text-link text-truncate" title="${cName}" 
                            data-action="navigate" 
                            data-page="company-details" 
                            data-params="${params}">
                            ${cName}
                           </a>`;
        }

        html += `
            <tr>
                <td class="col-idx">${index + 1}</td>
                <td class="col-date">${dateStr}</td>
                <td class="col-type">${typeHtml}</td>
                <td class="col-name">
                    <span class="text-truncate" title="${event.eventName || '(未命名)'}">${event.eventName || '(未命名)'}</span>
                </td>
                <td class="col-obj-tag">${objTagHtml}</td>
                <td class="col-obj-name">${objNameHtml}</td>
                <td class="col-user" title="${event.creator}">${event.creator}</td>
                <td class="col-actions">
                    <button class="btn-mini-view" title="查看完整報告" 
                            data-action="view-report" 
                            data-id="${event.eventId}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    </button>
                    <button class="btn-mini-view" title="編輯" 
                            data-action="edit-event" 
                            data-id="${event.eventId}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </td>
            </tr>`;
    });

    html += '</tbody></table>';
    tableContainer.innerHTML = html;
}

/**
 * 輔助：填入篩選選單與建立 Tabs
 */
function _populateEventFilterOptions() {
    const tabsContainer = document.getElementById('event-type-tabs');
    const creatorSelect = document.getElementById('event-filter-creator');
    
    // 1. 類型 Tabs (從 System Config)
    const types = window.CRM_APP?.systemConfig?.['事件類型'] || [];
    if (tabsContainer) {
        let html = `<button class="tab-btn active" data-action="filter-type" data-value="all">全部</button>`;
        types.forEach(t => {
            html += `<button class="tab-btn" data-action="filter-type" data-value="${t.value}">${t.note || t.value}</button>`;
        });
        tabsContainer.innerHTML = html;
    }

    // 2. 建立者 (從資料中提取唯一值)
    if (creatorSelect) {
        creatorSelect.innerHTML = '<option value="all">所有建立者</option>';
        const creators = new Set(_fullEventData.map(e => e.creator).filter(Boolean));
        [...creators].sort().forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            creatorSelect.appendChild(opt);
        });
    }
}

/**
 * 輔助：注入 CSS
 */
function _injectEventListStyles() {
    const styleId = 'event-list-table-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
        /* CRM 分段式 Tabs 樣式 (Segmented Tabs) */
        .crm-tabs {
            display: inline-flex;
            background-color: var(--bg-locked, #f3f4f6);
            padding: 4px;
            border-radius: 8px;
            gap: 4px;
        }
        .crm-tabs .tab-btn {
            background: transparent;
            border: none;
            padding: 6px 16px;
            font-size: 0.95rem;
            color: var(--text-muted, #6b7280);
            cursor: pointer;
            border-radius: 6px;
            transition: all 0.2s;
            font-weight: 500;
        }
        .crm-tabs .tab-btn:hover {
            color: var(--text-main, #111827);
        }
        .crm-tabs .tab-btn.active {
            background-color: #ffffff;
            color: var(--primary-color, #2563eb);
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            font-weight: 600;
        }

        /* 列表容器 */
        .event-list-container { width: 100%; overflow-x: auto; background: var(--card-bg, #fff); min-height: 200px; }
        .event-list-table { width: 100%; border-collapse: collapse; min-width: 1000px; }
        
        .event-list-table th { 
            padding: 12px 16px; 
            text-align: left; 
            background: var(--glass-bg); 
            color: var(--text-secondary); 
            font-weight: 600; 
            font-size: 0.9rem; 
            border-bottom: 1px solid var(--border-color); 
            white-space: nowrap; 
        }
        
        .event-list-table td { 
            padding: 10px 16px; 
            border-bottom: 1px solid var(--border-color); 
            vertical-align: middle; 
            font-size: 0.95rem; 
            color: var(--text-main); 
        }
        
        .event-list-table tr:not(.locked):hover { background-color: var(--glass-bg); }
        
        .event-list-table tr.locked { background-color: var(--bg-locked); color: var(--text-locked); }
        .event-list-table tr.locked td { color: var(--text-locked); }

        /* 欄位寬度與樣式 */
        .col-idx { width: 60px; text-align: center !important; color: var(--text-muted); font-weight: 600; }
        .col-date { width: 110px; white-space: nowrap; }
        .col-type { width: 110px; }
        .col-name { min-width: 200px; max-width: 300px; font-weight: 600; }
        .col-obj-tag { width: 90px; text-align: center; }
        .col-obj-name { min-width: 180px; max-width: 250px; }
        .col-user { width: 120px; white-space: nowrap; }
        .col-actions { width: 80px; text-align: center !important; }

        /* Tag 標籤樣式 (統一風格) */
        .common-chip { 
            display: inline-block; 
            padding: 3px 10px; 
            border-radius: 4px; 
            font-size: 0.8rem; 
            color: white; 
            white-space: nowrap; 
            font-weight: 500; 
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        
        /* 文字處理 */
        .text-truncate { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .text-link { color: var(--accent-blue); text-decoration: none; transition: color 0.2s; }
        .text-link:hover { text-decoration: underline; color: var(--primary-color); }

        /* 圖示按鈕樣式 */
        .btn-mini-view {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 6px;
            border-radius: 4px;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .btn-mini-view:hover {
            color: var(--accent-blue);
            background: #e0f2fe; 
        }
    `;
    document.head.appendChild(style);
}
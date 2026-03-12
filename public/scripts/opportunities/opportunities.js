// public/scripts/opportunities/opportunities.js
/**
 * 職責：管理「機會案件列表頁」的圖表、篩選、列表渲染與操作
 * @version 7.3.0 (Phase 8.11 - Table Data Flow Decoupling)
 * @date 2026-03-12
 * @description [Performance Patch] Decoupled Opportunities Table from the bulk opportunitiesData payload. Table now queries the backend via API with URL parameters for filtering, sorting, and pagination. Chip Wall retains existing behavior.
 */

// ==================== 全域變數 (此頁面專用) ====================
let opportunitiesData = [];
let reverseNameMaps = {};

// 篩選與排序狀態
let opportunitiesListFilters = { 
    year: 'all', 
    type: 'all', 
    source: 'all', 
    time: 'all', 
    stage: 'all',
    probability: 'all', 
    channel: 'all', 
    scale: 'all' 
};
let currentOppSort = { field: 'effectiveLastActivity', direction: 'desc' };

// ==================== 主要功能函式 ====================

/**
 * 載入並渲染所有機會案件頁面
 * @param {string} [query=''] - 搜尋關鍵字
 */
async function loadOpportunities(query = '') {
    const container = document.getElementById('page-opportunities');
    if (!container) return;

    // 1. 渲染頁面骨架
    container.innerHTML = `
        <div id="opportunities-dashboard-container" class="dashboard-grid-flexible" style="margin-bottom: 24px;">
            <div class="loading show" style="grid-column: span 12;"><div class="spinner"></div><p>載入分析圖表中...</p></div>
        </div>

        <div id="opportunity-chip-wall-container" class="dashboard-widget" style="margin-bottom: 24px; display: none;">
            <div class="widget-header"><h2 class="widget-title">機會階段總覽 (晶片牆)</h2></div>
            <div class="widget-content">
                <div class="loading show"><div class="spinner"></div><p>載入晶片牆資料中...</p></div>
            </div>
        </div>

        <div class="dashboard-widget">
            <div class="widget-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; padding-bottom: 15px;">
                <div style="display: flex; align-items: baseline; gap: 15px;">
                    <h2 class="widget-title">機會案件列表</h2>
                    <span style="font-size: 0.9rem; color: var(--text-muted);">共 <span id="opportunities-count-display">0</span> 筆</span>
                </div>
                
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div id="opportunities-filter-status" style="display: none; align-items: center; gap: 8px;">
                        <span id="opportunities-filter-text" style="font-size: 0.85rem; font-weight: 600; color: var(--accent-blue);"></span>
                        <button class="action-btn small danger" data-action="clear-filters" style="padding: 2px 8px;">清除</button>
                    </div>

                    <div id="opportunity-list-filters" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        <select id="opp-year-filter" class="form-select-sm" data-filter="year"><option value="all">所有年份</option></select>
                        <select id="opp-type-filter" class="form-select-sm" data-filter="type"><option value="all">所有種類</option></select>
                        <select id="opp-source-filter" class="form-select-sm" data-filter="source"><option value="all">所有來源</option></select>
                        <select id="opp-time-filter" class="form-select-sm" data-filter="time">
                            <option value="all">活動日期 (全部)</option>
                            <option value="7">近 7 天</option>
                            <option value="30">近 30 天</option>
                            <option value="90">近 90 天</option>
                        </select>
                        <select id="opp-stage-filter" class="form-select-sm" data-filter="stage"><option value="all">所有階段</option></select>
                    </div>
                </div>
            </div>

            <div class="search-row" style="padding: 0 1.5rem 1.25rem;">
                <input type="text" class="search-box" id="opportunities-list-search" placeholder="搜尋機會名稱或客戶公司..." style="width: 100%; max-width: none;" value="${query}">
            </div>

            <div id="opportunities-page-content" class="widget-content" style="padding: 0;">
                <div class="loading show"><div class="spinner"></div><p>載入機會資料中...</p></div>
            </div>
        </div>
    `;

    // 2. 綁定事件委派
    container.removeEventListener('click', handleOpportunitiesClick);
    container.addEventListener('click', handleOpportunitiesClick);
    
    // 綁定搜尋事件
    const searchInput = document.getElementById('opportunities-list-search');
    if (searchInput) {
        searchInput.removeEventListener('keyup', handleOpportunitiesSearch);
        searchInput.addEventListener('keyup', handleOpportunitiesSearch);
    }

    try {
        const [dashboardResult, opportunitiesResult, systemConfigResult] = await Promise.all([
            authedFetch(`/api/opportunities/dashboard`),
            authedFetch(`/api/opportunities?page=0`), // page=0 is strictly reserved to fetch raw array for ChipWall/Dashboard
            authedFetch(`/api/config`)
        ]);

        if (systemConfigResult) {
            window.CRM_APP.systemConfig = systemConfigResult;
            
            // 填充下拉選單選項
            populateOppFilterOptions('opp-type-filter', systemConfigResult['機會種類'], '所有種類');
            populateOppFilterOptions('opp-source-filter', systemConfigResult['機會來源'], '所有來源');
            populateOppFilterOptions('opp-stage-filter', systemConfigResult['機會階段'], '所有階段');
            
            // 監聽選單變更
            document.querySelectorAll('#opportunity-list-filters select').forEach(select => {
                select.addEventListener('change', handleOppFilterDropdownChange);
            });
        }

        if (dashboardResult.success && dashboardResult.data && dashboardResult.data.chartData) {
            const systemConfig = window.CRM_APP?.systemConfig; 
            if (systemConfig) {
                reverseNameMaps = {
                    opportunitySource: new Map((systemConfig['機會來源'] || []).map(i => [i.note || i.value, i.value])), 
                    opportunityType: new Map((systemConfig['機會種類'] || []).map(i => [i.note || i.value, i.value])),
                    currentStage: new Map((systemConfig['機會階段'] || []).map(i => [i.note || i.value, i.value])),
                    orderProbability: new Map((systemConfig['下單機率'] || []).map(i => [i.note || i.value, i.value])),
                    potentialSpecification: new Map((systemConfig['可能下單規格'] || []).map(i => [i.note || i.value, i.value])),
                    salesChannel: new Map((systemConfig['可能銷售管道'] || []).map(i => [i.note || i.value, i.value])),
                    deviceScale: new Map((systemConfig['設備規模'] || []).map(i => [i.note || i.value, i.value]))
                };
            }
            renderOpportunityCharts(dashboardResult.data.chartData);
        }

        let opportunities = opportunitiesResult || [];

        const yearSet = new Set();
        opportunities.forEach(opp => {
             // Strict guard: rely on backend computation, deploy strict legacy fallback just in case
             if (typeof opp.effectiveLastActivity !== 'number' || Number.isNaN(opp.effectiveLastActivity)) {
                 opp.effectiveLastActivity = new Date(opp.lastUpdateTime || opp.createdTime || 0).getTime();
             }
             
             const createdDate = new Date(opp.createdTime);
             opp.creationYear = isNaN(createdDate.getTime()) ? null : createdDate.getFullYear();
             if (opp.creationYear) yearSet.add(opp.creationYear);
        });

        // 動態生成年份選項
        const yearFilter = document.getElementById('opp-year-filter');
        if (yearFilter) {
            const sortedYears = Array.from(yearSet).sort((a, b) => b - a);
            sortedYears.forEach(y => {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = `${y} 年`;
                yearFilter.appendChild(opt);
            });
        }

        opportunitiesData = opportunities;

        // 保留晶片牆邏輯
        const chipWallContainer = document.getElementById('opportunity-chip-wall-container');
        if (typeof ChipWall !== 'undefined' && chipWallContainer) {
            const ongoingOpportunities = opportunitiesData.filter(opp => opp.currentStatus === '進行中');
            const chipWall = new ChipWall('#opportunity-chip-wall-container', {
                stages: window.CRM_APP?.systemConfig?.['機會階段'] || [], 
                items: ongoingOpportunities,
                colorConfigKey: '機會種類',
                useDynamicSize: true,
                isCollapsible: true,
                isDraggable: true,
                showControls: true, 
                onItemUpdate: () => {
                    // Phase 8.10: Unify stale signaling via dashboardManager contract
                    if (window.dashboardManager && typeof window.dashboardManager.markStale === 'function') {
                        window.dashboardManager.markStale();
                    } else if (window.CRM_APP?.pageConfig?.dashboard) {
                        window.CRM_APP.pageConfig.dashboard.loaded = false; 
                    }
                },
                onFilterChange: (filters) => {
                    opportunitiesListFilters.year = filters.year;
                    opportunitiesListFilters.type = filters.type; 
                    opportunitiesListFilters.source = filters.source;
                    opportunitiesListFilters.time = filters.time;
                    filterAndRenderOpportunities(); 
                }
            });
            chipWall.render();
        }

        // 執行初始表格 API 渲染 (Decoupled from opportunitiesData)
        fetchAndRenderOpportunitiesTable();

    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('❌ 載入機會案件頁面失敗:', error);
            const contentEl = document.getElementById('opportunities-page-content');
            if (contentEl) contentEl.innerHTML = `<div class="alert alert-error">載入資料失敗: ${error.message}</div>`;
        }
    }
}

/**
 * 統一事件處理器 (Centralized Event Handler)
 */
function handleOpportunitiesClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const payload = btn.dataset;

    switch (action) {
        case 'sort':
            handleOppSort(payload.field);
            break;
        case 'delete-opp':
            confirmDeleteOpportunity(payload.oppId, payload.name);
            break;
        case 'clear-filters':
            clearAllOppFilters();
            break;
        case 'navigate':
            e.preventDefault();
            let params = {};
            if (payload.params) {
                try {
                    params = JSON.parse(payload.params);
                } catch (err) {
                    console.error('解析導航參數失敗', err);
                }
            }
            CRM_APP.navigateTo(payload.page, params);
            break;
    }
}

function populateOppFilterOptions(selectId, options, defaultText) {
    const el = document.getElementById(selectId);
    if (!el) return;
    el.innerHTML = `<option value="all">${defaultText}</option>` + 
        (options || []).map(opt => `<option value="${opt.value}">${opt.note || opt.value}</option>`).join('');
}

function handleOppFilterDropdownChange(e) {
    const filterKey = e.target.dataset.filter;
    opportunitiesListFilters[filterKey] = e.target.value;
    filterAndRenderOpportunities(); // State mapping -> Table Fetch
}

function clearAllOppFilters() {
    opportunitiesListFilters = { 
        year: 'all', type: 'all', source: 'all', time: 'all', 
        stage: 'all', probability: 'all', channel: 'all', scale: 'all' 
    };
    
    document.querySelectorAll('#opportunity-list-filters select').forEach(select => {
        select.value = 'all';
    });

    if (typeof Highcharts !== 'undefined') {
        Highcharts.charts.forEach(chart => {
            if (chart && chart.series && chart.series[0] && chart.series[0].points) {
                 chart.series[0].points.forEach(point => {
                     if (point && typeof point.select === 'function') point.select(false, true);
                 });
            }
        });
    }
    fetchAndRenderOpportunitiesTable(); // Direct fetch
}

/**
 * [Phase 8.11 Decoupling]
 * State Updater Wrapper. Translates chart clicks and widget interactions into state, then fetches the Table via API.
 */
function filterAndRenderOpportunities(filterKey, filterDisplayValue) {
    if (filterKey && filterDisplayValue) {
        const filterValue = reverseNameMaps[filterKey]?.get(filterDisplayValue) || filterDisplayValue;
        if (opportunitiesListFilters[filterKey] === filterValue) {
             opportunitiesListFilters[filterKey] = 'all'; 
        } else {
             opportunitiesListFilters[filterKey] = filterValue;
        }
        
        const uiKey = filterKey.replace('opportunity', '').toLowerCase();
        const selectEl = document.querySelector(`#opportunity-list-filters select[data-filter="${uiKey}"]`);
        if (selectEl) selectEl.value = opportunitiesListFilters[filterKey];
    }

    fetchAndRenderOpportunitiesTable();
}

/**
 * [Phase 8.11 Decoupling]
 * Fetches decoupled table data directly from the backend API.
 */
async function fetchAndRenderOpportunitiesTable() {
    const listContent = document.getElementById('opportunities-page-content');
    const filterStatus = document.getElementById('opportunities-filter-status');
    const filterText = document.getElementById('opportunities-filter-text');
    const countDisplay = document.getElementById('opportunities-count-display');
    const query = document.getElementById('opportunities-list-search')?.value.trim() || '';

    if (!listContent) return;

    // Update UI for active filters
    const activeFiltersCount = Object.entries(opportunitiesListFilters).filter(([k, v]) => v !== 'all' && v !== undefined).length;
    if (activeFiltersCount > 0) {
        if (filterStatus) filterStatus.style.display = 'flex';
        if (filterText) filterText.textContent = `已套用 ${activeFiltersCount} 個篩選`;
    } else {
        if (filterStatus) filterStatus.style.display = 'none';
    }

    listContent.innerHTML = '<div class="loading show"><div class="spinner"></div><p>載入機會資料中...</p></div>';

    try {
        const params = new URLSearchParams();
        params.append('page', '1');
        params.append('limit', '500'); // Baseline reasonable limit for unpaginated UI
        if (query) params.append('q', query);
        
        if (currentOppSort.field) {
            params.append('sortField', currentOppSort.field);
            params.append('sortDirection', currentOppSort.direction);
        }

        // Map UI filters to backend params
        const keyMapping = { 'type': 'type', 'source': 'source', 'stage': 'stage' };

        for (const [key, value] of Object.entries(opportunitiesListFilters)) {
            if (value !== 'all' && value !== undefined) {
                const apiParam = keyMapping[key] || key;
                params.append(apiParam, value);
            }
        }

        const result = await authedFetch(`/api/opportunities?${params.toString()}`);
        
        const tableData = result.data || result || [];
        const totalCount = result.total !== undefined ? result.total : tableData.length;

        if (countDisplay) countDisplay.textContent = totalCount;
        listContent.innerHTML = renderOpportunitiesTable(tableData);

    } catch (error) {
        console.error('Fetch table data failed:', error);
        listContent.innerHTML = `<div class="alert alert-error">載入表格失敗: ${error.message}</div>`;
    }
}

function handleOpportunitiesSearch(event) {
    handleSearch(() => fetchAndRenderOpportunitiesTable());
}

function handleOppSort(field) {
    if (currentOppSort.field === field) {
        currentOppSort.direction = currentOppSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentOppSort.field = field;
        currentOppSort.direction = 'desc'; 
    }
    fetchAndRenderOpportunitiesTable();
}

function renderOpportunitiesTable(opportunities) {
    const styleId = 'opportunity-list-upgraded-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            .opp-list-container { width: 100%; overflow-x: auto; background: var(--card-bg, #fff); }
            .opp-list-table { width: 100%; border-collapse: collapse; min-width: 1000px; }
            .opp-list-table th { padding: 12px 16px; text-align: left; background: var(--glass-bg); color: var(--text-secondary); font-weight: 600; font-size: 0.9rem; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
            .opp-list-table td { padding: 12px 16px; border-bottom: 1px solid var(--border-color); vertical-align: middle; font-size: 0.95rem; color: var(--text-main); }
            .opp-list-table tr:not(.locked):hover { background-color: var(--glass-bg); }
            
            .opp-list-table tr.locked { background-color: var(--bg-locked); color: var(--text-locked); }
            .opp-list-table tr.locked td { color: var(--text-locked); }

            .opp-type-chip { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 0.8rem; color: white; white-space: nowrap; font-weight: 500; }
            .opp-sales-chip { display: inline-block; padding: 3px 12px; border-radius: 12px; font-size: 0.8rem; color: white; white-space: nowrap; font-weight: 500; }
            .opp-channel-chip { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; border: 1px solid #e5e7eb; background-color: #f9fafb; color: #374151; white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
            .opp-status-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; background: #f3f4f6; color: #4b5563; }
            
            .opp-list-table th.sortable { cursor: pointer; transition: color 0.2s; }
            .opp-list-table th.sortable:hover { color: var(--accent-blue); }
            .opp-sort-icon { margin-left: 4px; font-size: 0.8em; opacity: 0.5; }

            .col-idx { width: 60px; text-align: center !important; color: var(--text-muted); font-weight: 600; }
            .col-actions { width: 80px; text-align: center !important; }
            .btn-mini-delete { background: none; border: none; color: #9ca3af; cursor: pointer; padding: 6px; border-radius: 4px; transition: all 0.2s; }
            .btn-mini-delete:hover { color: #ef4444; background: #fee2e2; }
        `;
        document.head.appendChild(style);
    }

    if (!opportunities || opportunities.length === 0) {
        return '<div class="alert alert-info" style="margin:2rem; text-align:center;">暫無符合條件的機會案件資料</div>';
    }

    const renderSortHeader = (field, label) => {
        let icon = '↕';
        if (currentOppSort.field === field) icon = currentOppSort.direction === 'asc' ? '↑' : '↓';
        return `<th class="sortable" data-action="sort" data-field="${field}">${label} <span class="opp-sort-icon">${icon}</span></th>`;
    };

    let html = `<div class="opp-list-container"><table class="opp-list-table"><thead><tr>
                    <th class="col-idx">項次</th>
                    ${renderSortHeader('effectiveLastActivity', '最後活動')}
                    <th>機會種類</th>
                    ${renderSortHeader('opportunityName', '機會名稱')}
                    ${renderSortHeader('customerCompany', '客戶公司')}
                    <th>銷售模式</th>
                    <th>主要通路</th>
                    <th>階段</th>
                    <th class="col-actions">操作</th>
                </tr></thead><tbody>`;

    const systemConfig = window.CRM_APP?.systemConfig || {};
    const stageNotes = new Map((systemConfig['機會階段'] || []).map(s => [s.value, s.note || s.value]));
    const typeColors = new Map((systemConfig['機會種類'] || []).map(t => [t.value, t.color]));
    const modelColors = new Map((systemConfig['銷售模式'] || []).map(m => [m.value, m.color]));

    opportunities.forEach((opp, index) => {
        const stageName = stageNotes.get(opp.currentStage) || opp.currentStage || '-';
        const typeColor = typeColors.get(opp.opportunityType) || '#9ca3af';
        const modelColor = modelColors.get(opp.salesModel) || '#6b7280';
        
        // Fully converged contract usage
        const channelText = opp.salesChannel || '-';
        const lastActivityDate = opp.effectiveLastActivity ? new Date(opp.effectiveLastActivity).toLocaleDateString('zh-TW') : '-';

        const oppParams = JSON.stringify({ opportunityId: opp.opportunityId }).replace(/"/g, '&quot;');
        const compParams = JSON.stringify({ companyName: encodeURIComponent(opp.customerCompany || '') }).replace(/"/g, '&quot;');
        const safeOppName = (opp.opportunityName || '').replace(/"/g, '&quot;');

        html += `
            <tr>
                <td class="col-idx">${index + 1}</td>
                <td style="white-space:nowrap;">${lastActivityDate}</td>
                <td><span class="opp-type-chip" style="background:${typeColor}">${opp.opportunityType || '未分類'}</span></td>
                <td style="min-width:180px;">
                    <a href="#" class="text-link" 
                       data-action="navigate" 
                       data-page="opportunity-details" 
                       data-params="${oppParams}">
                        <strong>${opp.opportunityName || '(未命名)'}</strong>
                    </a>
                </td>
                <td style="min-width:150px;">
                    <a href="#" class="text-link" style="color:var(--text-secondary);" 
                       data-action="navigate" 
                       data-page="company-details" 
                       data-params="${compParams}">
                        ${opp.customerCompany || '-'}
                    </a>
                </td>
                <td><span class="opp-sales-chip" style="background:${modelColor}">${opp.salesModel || '-'}</span></td>
                <td><span class="opp-channel-chip" title="${channelText}">${channelText}</span></td>
                <td><span class="opp-status-badge">${stageName}</span></td>
                <td class="col-actions">
                    <button class="btn-mini-delete" title="刪除案件" 
                            data-action="delete-opp" 
                            data-opp-id="${opp.opportunityId}" 
                            data-name="${safeOppName}">
                        <svg style="width:18px;height:18px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path></svg>
                    </button>
                </td>
            </tr>`;
    });

    return html + '</tbody></table></div>';
}

function renderOpportunityCharts(chartData) {
    const container = document.getElementById('opportunities-dashboard-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">機會趨勢 (近30天)</h2></div><div id="opp-trend-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">機會來源分佈</h2></div><div id="opp-source-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">機會種類分佈</h2></div><div id="opp-type-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">機會階段分佈</h2></div><div id="opp-stage-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">下單機率</h2></div><div id="opp-probability-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">可能下單規格</h2></div><div id="opp-spec-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">可能銷售管道</h2></div><div id="opp-channel-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">設備規模</h2></div><div id="opp-scale-chart" class="widget-content" style="height: 250px;"></div></div>
    `;

    setTimeout(() => {
        if (typeof Highcharts !== 'undefined' && typeof createThemedChart === 'function' && chartData) {
            renderOppTrendChart(chartData.trend);
            createThemedChart('opp-source-chart', getPieChartOptions('來源', chartData.source, 'opportunitySource'));
            createThemedChart('opp-type-chart', getPieChartOptions('種類', chartData.type, 'opportunityType'));
            renderOppStageChart(chartData.stage);
            createThemedChart('opp-probability-chart', getPieChartOptions('機率', chartData.probability, 'orderProbability'));
            createThemedChart('opp-spec-chart', getPieChartOptions('規格', chartData.specification, 'potentialSpecification'));
            createThemedChart('opp-channel-chart', getPieChartOptions('管道', chartData.channel, 'salesChannel'));
            createThemedChart('opp-scale-chart', getPieChartOptions('規模', chartData.scale, 'deviceScale'));
        }
    }, 0);
}

function getPieChartOptions(seriesName, data, filterKey) {
    if (!Array.isArray(data)) data = [];
    return {
        chart: { type: 'pie' },
        title: { text: '' },
        tooltip: { pointFormat: '{series.name}: <b>{point.percentage:.1f}%</b> ({point.y} 件)' },
        plotOptions: {
            pie: {
                allowPointSelect: true,
                cursor: 'pointer',
                dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.percentage:.1f}%', distance: 20 },
                point: { events: { click: function() { filterAndRenderOpportunities(filterKey, this.name); } } }
            }
        },
        series: [{ name: seriesName, data: data.map(d => ({ name: d.name || '未分類', y: d.y || 0 })) }]
    };
}

function renderOppTrendChart(data) {
     if (!data || !Array.isArray(data)) return;
     createThemedChart('opp-trend-chart', {
        chart: { type: 'line' },
        title: { text: '' },
        xAxis: { categories: data.map(d => d[0] ? d[0].substring(5) : '') },
        yAxis: { title: { text: '數量' }, allowDecimals: false },
        legend: { enabled: false },
        series: [{ name: '機會數', data: data.map(d => d[1] || 0) }]
    });
}

function renderOppStageChart(data) {
     if (!data || !Array.isArray(data)) return;
     const validatedData = data.map(d => [d[0] || '未分類', d[1] || 0]);
     createThemedChart('opp-stage-chart', {
        chart: { type: 'bar' },
        title: { text: '' },
        xAxis: { categories: validatedData.map(d => d[0]), title: { text: null } },
        yAxis: { min: 0, title: { text: '案件數量', align: 'high' }, allowDecimals: false },
        legend: { enabled: false },
        series: [{ name: '數量', data: validatedData.map(d => d[1]) }],
        plotOptions: { bar: { cursor: 'pointer', point: { events: { click: function() { filterAndRenderOpportunities('currentStage', this.category); } } } } }
    });
}

async function confirmDeleteOpportunity(oppId, opportunityName) {
    if (!oppId) { showNotification('無法刪除：缺少必要的紀錄 ID。', 'error'); return; }
    const message = `您確定要"永久刪除"\n機會案件 "${opportunityName || '(未命名)'}" 嗎？\n此操作無法復原！`;
    showConfirmDialog(message, async () => {
        showLoading('正在刪除...');
        try {
            const result = await authedFetch(`/api/opportunities/${oppId}`, { method: 'DELETE' });
            if (result.success) {
                await loadOpportunities(document.getElementById('opportunities-list-search')?.value || '');
            } else { throw new Error(result.details || '刪除操作失敗'); }
        } catch (error) { if (error.message !== 'Unauthorized') console.error('刪除失敗:', error); }
        finally { hideLoading(); }
    });
}

async function loadFollowUpPage() {
    const container = document.getElementById('page-follow-up');
    if (!container) return;
    
    container.innerHTML = '<div class="loading show"><div class="spinner"></div><p>載入待追蹤清單中...</p></div>';
    
    container.removeEventListener('click', handleOpportunitiesClick);
    container.addEventListener('click', handleOpportunitiesClick);

    try {
        const result = await authedFetch('/api/dashboard');
        if (!result.success || !result.data) throw new Error(result.error || '無法獲取資料');
        const followUpFullList = (result.data.followUpList || []).sort((a, b) => (a.effectiveLastActivity || 0) - (b.effectiveLastActivity || 0));
        if (followUpFullList.length === 0) {
            container.innerHTML = '<div class="alert alert-success" style="padding: 2rem; text-align: center;">🎉 太棒了！目前沒有需要追蹤的機會案件。</div>';
        } else {
            const thresholdDays = window.CRM_APP?.systemConfig?.FOLLOW_UP?.DAYS_THRESHOLD || 7;
            container.innerHTML = `<div class="dashboard-widget"><div class="widget-header"><h2 class="widget-title">待追蹤案件 (${followUpFullList.length})</h2></div><div class="widget-content"><div class="alert alert-warning">⚠️ 已超過 ${thresholdDays} 天未有新活動。</div>${renderOpportunitiesTable(followUpFullList)}</div></div>`;
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') container.innerHTML = '<div class="alert alert-error">載入待追蹤清單失敗。</div>';
    }
}

if (window.CRM_APP) {
    if (!window.CRM_APP.pageModules) window.CRM_APP.pageModules = {};
    window.CRM_APP.pageModules.opportunities = loadOpportunities;
    window.CRM_APP.pageModules['follow-up'] = loadFollowUpPage;
}
// public/scripts/sales/sales-analysis.js
/**
 * @version 1.7.2 (Bug Fix Patch)
 * @date 2026-04-21
 * @changelog
 * - [Bug Fix] Replaced || with ?? in fetchAndRenderSalesData for startDate and endDate to strictly preserve null or empty string states for "歷史全資料".
 * - [Bug Fix] Fixed "歷史全資料" inconsistent logic by explicitly handling null parameters.
 * - [Bug Fix] Fixed timezone bug causing YTD to show as 12/31 instead of 01/01 by replacing toISOString() with local date formatter.
 */

// 輔助函式：使用本地時區格式化日期為 YYYY-MM-DD
function formatDateLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 全域狀態管理
let salesAnalysisData = null; 
let salesStartDate = null;
let salesEndDate = null;
let allWonDeals = [];         
let displayedDeals = [];      
let currentSalesModelFilter = 'all';

// 列表狀態
let currentSortState = { field: 'wonDate', direction: 'desc' };
let currentPage = 1;
let rowsPerPage = 100;

/**
 * 入口函數
 */
async function loadSalesAnalysisPage(startDateISO, endDateISO) {
    const container = document.getElementById('page-sales-analysis');
    if (!container) return;

    if (startDateISO === undefined && endDateISO === undefined) {
        // 初始載入預設為 YTD (使用 Local Time 避免 12/31 Bug)
        const now = new Date();
        salesStartDate = formatDateLocal(new Date(now.getFullYear(), 0, 1));
        salesEndDate = formatDateLocal(now);
    } else if (startDateISO === null && endDateISO === null) {
        // 明確捕捉 null 代表歷史全資料，確保狀態清空
        salesStartDate = '';
        salesEndDate = '';
    } else {
        salesStartDate = startDateISO || '';
        salesEndDate = endDateISO || '';
    }

    currentSalesModelFilter = 'all';

    // 1. 注入 CSS
    SalesAnalysisComponents.injectStyles();

    // 2. 渲染基礎骨架
    container.innerHTML = SalesAnalysisComponents.getMainLayout(salesStartDate, salesEndDate);

    const refreshBtn = document.getElementById('sales-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshSalesAnalysis);

    // 3. 獲取數據
    await fetchAndRenderSalesData(salesStartDate, salesEndDate);
}

// 快速過濾日期選擇
window.setQuickDate = function(range) {
    const now = new Date();
    let start = '';
    let end = '';
    const todayStr = formatDateLocal(now); 
    
    if (range === 'ytd') {
        start = formatDateLocal(new Date(now.getFullYear(), 0, 1)); 
        end = todayStr;
    } else if (range === '30d') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        start = formatDateLocal(thirtyDaysAgo); 
        end = todayStr;
    } else if (range === 'all') {
        start = '';
        end = '';
    }

    const startInput = document.getElementById('sales-start-date');
    const endInput = document.getElementById('sales-end-date');
    if(startInput) startInput.value = start;
    if(endInput) endInput.value = end;
    
    refreshSalesAnalysis();
};

function refreshSalesAnalysis() {
    const startDateInput = document.getElementById('sales-start-date');
    const endDateInput = document.getElementById('sales-end-date');
    if (!startDateInput || !endDateInput) return;

    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (startDate === '' && endDate === '') {
        document.getElementById('sales-overview-content').innerHTML = '<div class="loading show"><div class="spinner"></div></div>';
        document.getElementById('sales-kpi-content').innerHTML = '';
        document.getElementById('won-deals-content').innerHTML = '<div class="loading show" style="padding: 20px;"><div class="spinner"></div></div>';
        // 傳遞 null 以觸發明確的清除邏輯
        loadSalesAnalysisPage(null, null);
    } 
    else if (startDate && endDate) {
        if (startDate <= endDate) {
            document.getElementById('sales-overview-content').innerHTML = '<div class="loading show"><div class="spinner"></div></div>';
            document.getElementById('sales-kpi-content').innerHTML = '';
            document.getElementById('won-deals-content').innerHTML = '<div class="loading show" style="padding: 20px;"><div class="spinner"></div></div>';
            loadSalesAnalysisPage(startDate, endDate);
        } else {
            showNotification('開始日期不能大於結束日期', 'warning');
        }
    } else {
        showNotification('請選擇有效的開始和結束日期', 'warning');
    }
}

async function fetchAndRenderSalesData(startDate, endDate) {
    try {
        // [Bug Fix] 使用 ?? 取代 || 確保不會誤判空字串或 null
        const sParam = startDate ?? '';
        const eParam = endDate ?? '';
        const mParam = currentSalesModelFilter || 'all'; 

        const result = await authedFetch(`/api/sales-analysis?startDate=${sParam}&endDate=${eParam}&salesModel=${encodeURIComponent(mParam)}`);
        if (!result.success || !result.data) throw new Error(result.error || '無法獲取分析數據');
        
        salesAnalysisData = result.data;
        
        allWonDeals = salesAnalysisData.allWonDeals || [];
        
        SalesAnalysisComponents.initSalesModelFilterOptions(allWonDeals);
        const select = document.getElementById('sales-model-filter');
        if (select && currentSalesModelFilter) {
            select.value = currentSalesModelFilter;
        }
        
        SalesAnalysisComponents.initPaginationOptions([50, 100, 500], rowsPerPage);

        displayedDeals = [...(salesAnalysisData.wonDeals || [])];
        sortDeals(currentSortState.field, currentSortState.direction, true);

        if (salesAnalysisData.overview && salesAnalysisData.kpis && salesAnalysisData.byType) {
            SalesAnalysisComponents.renderSalesOverviewAndKpis(salesAnalysisData.overview, salesAnalysisData.kpis);
            SalesAnalysisComponents.renderAllCharts(
                salesAnalysisData.byType || [], 
                salesAnalysisData.bySource || [], 
                salesAnalysisData.byProduct || [], 
                salesAnalysisData.byChannel || []
            );
        } else {
            console.warn('[Sales Analysis] Backend SSOT data incomplete, falling back to local computation.');
            updateDashboard(displayedDeals);
        }

        renderPaginatedTable();

    } catch (error) {
        console.error('載入失敗:', error);
        document.getElementById('sales-charts-container').innerHTML = `<div class="alert alert-error">載入失敗: ${error.message}</div>`;
    }
}

function sortDeals(field, direction, sortDisplayedOnly = false) {
    const targetArray = sortDisplayedOnly ? displayedDeals : allWonDeals;
    targetArray.sort((a, b) => {
        let valA, valB;
        if (field === 'wonDate') {
            valA = a.wonDate ? new Date(a.wonDate).getTime() : 0;
            valB = b.wonDate ? new Date(b.wonDate).getTime() : 0;
        } else if (field === 'numericValue') {
            valA = a.numericValue || 0;
            valB = b.numericValue || 0;
        } else return 0;
        return direction === 'asc' ? valA - valB : valB - valA;
    });
    if (!sortDisplayedOnly) displayedDeals = [...allWonDeals];
}

function updateDashboard(deals) {
    if (typeof SalesAnalysisHelper.calculateOverview !== 'function') return;

    const overview = SalesAnalysisHelper.calculateOverview(deals);
    const kpis = SalesAnalysisHelper.calculateKpis(deals);
    SalesAnalysisComponents.renderSalesOverviewAndKpis(overview, kpis);

    const typeData = SalesAnalysisHelper.calculateGroupStats(deals, 'opportunityType', 'value');
    const sourceData = SalesAnalysisHelper.calculateGroupStats(deals, 'opportunitySource', 'value');
    const productData = SalesAnalysisHelper.calculateProductStats(deals);
    const channelData = SalesAnalysisHelper.calculateChannelStats(deals);

    SalesAnalysisComponents.renderAllCharts(typeData, sourceData, productData, channelData);
}

function renderPaginatedTable() {
    const countDisplay = document.getElementById('deals-count-display');
    if (countDisplay) countDisplay.textContent = displayedDeals.length;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const pageDeals = displayedDeals.slice(startIndex, startIndex + rowsPerPage);

    SalesAnalysisComponents.renderWonDealsTable(
        pageDeals, 
        currentPage, 
        rowsPerPage, 
        currentSortState,
        salesAnalysisData.salesModelColors || {},
        salesAnalysisData.eventTypeColors || {}
    );
    SalesAnalysisComponents.updatePaginationControls(currentPage, displayedDeals.length, rowsPerPage);
}

window.handleSalesModelFilterChange = async function() {
    const select = document.getElementById('sales-model-filter');
    currentSalesModelFilter = select ? select.value : 'all';
    
    document.getElementById('sales-overview-content').innerHTML = '<div class="loading show"><div class="spinner"></div></div>';
    const wonDealsContent = document.getElementById('won-deals-content');
    if(wonDealsContent) {
        wonDealsContent.innerHTML = '<div class="loading show" style="padding: 20px;"><div class="spinner"></div></div>';
    }
    
    currentPage = 1;
    await fetchAndRenderSalesData(salesStartDate, salesEndDate);
};

window.handleSortTable = function(field) {
    if (currentSortState.field === field) {
        currentSortState.direction = currentSortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortState.field = field;
        currentSortState.direction = 'desc';
    }
    sortDeals(currentSortState.field, currentSortState.direction, true);
    renderPaginatedTable();
};

window.handleRowsPerPageChange = function(value) {
    if (value) {
        rowsPerPage = parseInt(value);
        currentPage = 1; 
        SalesAnalysisComponents.initPaginationOptions([50, 100, 500], rowsPerPage);
        renderPaginatedTable();
    }
};

window.changePage = function(delta) {
    const totalPages = Math.ceil(displayedDeals.length / rowsPerPage);
    const newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderPaginatedTable();
    }
};

window.exportSalesToCSV = function() {
    const csvContent = SalesAnalysisHelper.generateCSV(displayedDeals);
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `成交案件分析_${salesStartDate || '全部'}_至_${salesEndDate || '全部'}.csv`;
    link.click();
    showNotification(`已開始下載 CSV`, 'success');
};

if (window.CRM_APP) {
    if (!window.CRM_APP.pageModules) window.CRM_APP.pageModules = {};
    window.CRM_APP.pageModules['sales-analysis'] = loadSalesAnalysisPage;
}
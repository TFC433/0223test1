// public/scripts/core/main.js (重構版: 序列化資源載入)
// 職責：系統初始化入口
// @version [Phase 2] Manual Refresh UX Removal
// @date 2026-04-15
// @changelog
// - Removed obsolete SmartPolling system.
// - Kept refreshCurrentView exactly as it was for local save/delete flows.

window.CRM_APP = window.CRM_APP || {};

// --- Main App Logic ---

CRM_APP.init = async function() {
    console.log('🚀 [Main] TFC CRM系統啟動中...');
    try {
        await this.loadResources();
        await this.loadConfig();
        LayoutManager.init();

        Router.init();

        if (window.kanbanBoardManager?.initialize) {
            window.kanbanBoardManager.initialize();
        }

        await this.handleInitialRoute();
        console.log('✅ [Main] 系統載入完成！');
    } catch (err) {
        if (err.message !== 'Unauthorized') {
            console.error('❌ [Main] 初始化失敗:', err);
            showNotification(`初始化失敗: ${err.message}`, 'error', 10000);
        }
    }
};

CRM_APP.loadConfig = async function() {
    try {
        const data = await authedFetch('/api/config');
        if (data) {
            this.systemConfig = data;
            this.updateAllDropdowns();
        }
    } catch (err) {
        console.error('[Main] 載入 Config 失敗:', err);
    }
};

CRM_APP.handleInitialRoute = async function() {
    const hash = window.location.hash.substring(1);
    if (hash) {
        const [pageName, paramsString] = hash.split('?');
        if (this.pageConfig[pageName]) {
            let params = {};
            if (paramsString) params = Object.fromEntries(new URLSearchParams(paramsString));
            await this.navigateTo(pageName, params, false);
            return;
        }
    }
    await this.navigateTo('dashboard', {}, false);
    window.history.replaceState(null, '', '#dashboard');
};

CRM_APP.loadResources = async function() {
    // 定義要載入的組件列表
    const components = [
        'contact-modals', 'opportunity-modals', 'meeting-modals', 
        'system-modals', 'event-log-modal', 'link-contact-modal', 
        'link-opportunity-modal', 'announcement-modals'
    ];
    
    const container = document.getElementById('modal-container');
    if (container) {
        // 序列化請求 (Sequential Fetch) 以防止 429 錯誤
        let htmls = [];
        for (const c of components) {
            try {
                const res = await fetch(`/components/modals/${c}.html`);
                if (res.ok) {
                    const text = await res.text();
                    htmls.push(text);
                } else {
                    console.warn(`[Main] ⚠ 載入模組失敗: ${c} (Status: ${res.status})`);
                }
            } catch (error) {
                console.error(`[Main] ❌ 載入模組發生錯誤: ${c}`, error);
            }
        }
        container.innerHTML = htmls.join('');
    }

    const types = ['general', 'iot', 'dt', 'dx'];
    
    // 序列化載入表單
    for (const t of types) {
        try {
            const file = `/components/forms/event-form-${t === 'dx' ? 'general' : t}.html`;
            const res = await fetch(file);
            if (res.ok) {
                const html = await res.text();
                // 儲存到全域變數中
                this.formTemplates[t] = html;
            } else {
                 console.warn(`[Main] ⚠ 載入表單失敗: ${t}`);
            }
        } catch (error) {
            console.error(`[Main] ❌ 載入表單發生錯誤: ${t}`, error);
        }
    }
};

// [ADD-BEGIN] refreshCurrentView
window.CRM_APP.refreshCurrentView = async function(successMsg) {
    // 1. Debounce Guard (500ms)
    const now = Date.now();
    if (window.CRM_APP._lastRefresh && (now - window.CRM_APP._lastRefresh < 500)) {
        return;
    }
    window.CRM_APP._lastRefresh = now;

    // 2. Determine Page Name
    let hash = window.location.hash.substring(1);
    let [pageName, paramStr] = hash.split('?');
    
    if (!pageName) pageName = 'dashboard';

    // 3. Special Handling: Event Editor -> Events List
    // If we just saved inside the standalone editor, we want to go back to the list and refresh it.
    if (pageName === 'event-editor' || hash.includes('event-editor')) {
        window.location.hash = '#events';
        pageName = 'events';
        paramStr = ''; 
    }

    // 4. Execute Loader
    const loader = window.CRM_APP.pageModules && window.CRM_APP.pageModules[pageName];
    
    if (loader) {
        try {
            // Parse params if any
            let params = {};
            if (paramStr) {
                params = Object.fromEntries(new URLSearchParams(paramStr));
            }

            // Handle Detail Pages vs List Pages signature
            // Detail pages usually expect an ID string or specific param
            const isDetailPage = pageName.includes('-details') || pageName === 'weekly-detail';
            
            if (isDetailPage) {
                // Try to guess the ID argument
                const id = params.weekId || params.opportunityId || params.companyName || Object.values(params)[0];
                if (id) await loader(id);
                else await loader(params);
            } else {
                // List pages usually take no args or an object
                await loader(params);
            }
        } catch (err) {
            console.error(`[Main] Soft refresh failed for ${pageName}:`, err);
        }
    } else {
        console.warn(`[Main] No loader found for page: ${pageName}. Soft refresh skipped.`);
    }
};
// [ADD-END] refreshCurrentView

// Global Helpers
function getCurrentUser() {
    return window.CRM_APP?.currentUser || localStorage.getItem('crmCurrentUserName') || '系統';
}

function logout() {
    localStorage.removeItem('crm-token');
    localStorage.removeItem('crmToken');
    localStorage.removeItem('crmCurrentUserName');
    localStorage.removeItem('crmUserRole');
    window.location.href = '/';
}

document.addEventListener('DOMContentLoaded', () => {
    if (!window.CRM_APP_INITIALIZED) {
        window.CRM_APP_INITIALIZED = true;
        if (typeof loadWeeklyBusinessPage === 'function') window.CRM_APP.pageModules['weekly-business'] = loadWeeklyBusinessPage;
        if (typeof navigateToWeeklyDetail === 'function') window.CRM_APP.pageModules['weekly-detail'] = navigateToWeeklyDetail;
        if (typeof loadSalesAnalysisPage === 'function') window.CRM_APP.pageModules['sales-analysis'] = loadSalesAnalysisPage;
        
        // 註冊內部運營頁面模組
        if (typeof loadInternalOpsPage === 'function') window.CRM_APP.pageModules['internal-ops'] = loadInternalOpsPage;

        CRM_APP.init();
    }
});
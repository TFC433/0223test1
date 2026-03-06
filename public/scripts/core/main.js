// public/scripts/core/main.js (重構版: Smart Polling + 序列化資源載入)
// 職責：系統初始化入口與智慧輪詢管理

window.CRM_APP = window.CRM_APP || {};

// --- Smart Polling Manager ---
const SmartPolling = {
    intervalId: null,
    isActive: true,
    lastActivity: Date.now(),
    currentInterval: 30000, // Default 30s
    dataTimestamp: 0,

    init() {
        console.log('🧠 [SmartPolling] 初始化智慧輪詢...');
        
        // 1. 監聽使用者活動 (Activity Tracking)
        const resetActivity = () => {
            this.lastActivity = Date.now();
            if (!this.isActive) this.resume();
        };
        ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt => 
            document.addEventListener(evt, () => {
                // Simple throttle for activity update
                if (Date.now() - this.lastActivity > 1000) resetActivity();
            }, { passive: true })
        );

        // 2. 監聽分頁可見性 (Visibility Tracking)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.slowDown(); // Background -> Slow poll
            } else {
                this.resume();   // Foreground -> Normal poll
            }
        });

        // 3. 啟動
        this.start();
    },

    start() {
        this.runCycle();
    },

    runCycle() {
        if (this.intervalId) clearTimeout(this.intervalId);

        // Calculate next delay based on state
        let delay = this.currentInterval;
        const now = Date.now();
        const isIdle = (now - this.lastActivity) > 60000; // 1 min idle
        
        // Logic:
        // - User Active: Normal (30s)
        // - User Idle (>1m): Slow (2m)
        // - Tab Hidden: Slower (5m)
        // - Modal Open: Pause (handled by check)

        if (document.hidden) {
            delay = 300000; // 5 mins
        } else if (isIdle) {
            delay = 120000; // 2 mins
        } else {
            delay = 30000; // 30 secs
        }

        // Check for open modals (Pause if editing)
        const hasOpenModal = document.querySelector('.modal[style*="display: block"]');
        if (hasOpenModal) {
            console.log('⏸ [SmartPolling] Modal open, skipping poll.');
            this.intervalId = setTimeout(() => this.runCycle(), 10000); // Check again in 10s
            return;
        }

        this.checkServer();
        this.intervalId = setTimeout(() => this.runCycle(), delay);
    },

    resume() {
        if (!this.isActive) {
            console.log('▶ [SmartPolling] Resuming normal speed.');
            this.isActive = true;
            this.currentInterval = 30000;
            this.runCycle(); // Restart immediately
        }
    },

    slowDown() {
        console.log('💤 [SmartPolling] Entering background mode.');
        this.isActive = false;
        // Logic handled in runCycle via document.hidden check
    },

    async checkServer() {
        try {
            // Check system status
            const result = await authedFetch('/api/system/status', { skipRefresh: true });
            if (result && result.success && result.lastWriteTimestamp) {
                const serverTime = result.lastWriteTimestamp;
                if (this.dataTimestamp === 0) {
                    this.dataTimestamp = serverTime;
                } else if (serverTime > this.dataTimestamp) {
                    console.warn(`[Sync] 偵測到新資料！伺服器: ${serverTime}`);
                    this.showRefreshNotice(true);
                }
            }
        } catch (err) {
            // Ignore auth errors or network blips
        }
    },

    showRefreshNotice(show) {
        const bar = document.getElementById('data-refresh-notification');
        if (bar) bar.style.display = show ? 'flex' : 'none';
    }
};

// --- Main App Logic ---

CRM_APP.init = async function() {
    console.log('🚀 [Main] TFC CRM系統啟動中...');
    try {
        await this.loadResources();
        await this.loadConfig();
        LayoutManager.init();
        
        // Use SmartPolling instead of legacy startDataPolling
        SmartPolling.init();

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
        // 【修改】將並發請求改為序列化請求 (Sequential Fetch) 以防止 429 錯誤
        // 舊寫法: await Promise.all(...) -> 會同時發出 8+ 個請求
        // 新寫法: for...of + await -> 一個接一個載入
        
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
    
    // 【修改】同樣將表單樣板改為序列化載入
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
        console.warn('[Main] Refresh skipped (debounced).');
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
        console.log('🔄 [Main] Saved in editor -> redirecting to events list.');
        window.location.hash = '#events';
        pageName = 'events';
        paramStr = ''; 
    }

    // 4. Execute Loader
    const loader = window.CRM_APP.pageModules && window.CRM_APP.pageModules[pageName];
    
    if (loader) {
        console.log(`🔄 [Main] Soft refreshing: ${pageName}`);
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

// Override legacy polling methods to use SmartPolling (if needed elsewhere)
window.CRM_APP.startDataPolling = () => SmartPolling.resume();
window.CRM_APP.stopDataPolling = () => SmartPolling.slowDown(); // or actually pause?
// Note: SyncService from sync-service.js might still exist if loaded. 
// We rely on main.js loading last or this overriding.

document.addEventListener('DOMContentLoaded', () => {
    if (!window.CRM_APP_INITIALIZED) {
        window.CRM_APP_INITIALIZED = true;
        if (typeof loadWeeklyBusinessPage === 'function') window.CRM_APP.pageModules['weekly-business'] = loadWeeklyBusinessPage;
        if (typeof navigateToWeeklyDetail === 'function') window.CRM_APP.pageModules['weekly-detail'] = navigateToWeeklyDetail;
        if (typeof loadSalesAnalysisPage === 'function') window.CRM_APP.pageModules['sales-analysis'] = loadSalesAnalysisPage;
        CRM_APP.init();
    }
});
// views/scripts/contacts.js
/**
 * ============================================================================
 * File: public/scripts/contacts/contacts.js
 * Version: v8.2.2 (Phase 8.2 CORE UX Polish)
 * Date: 2026-03-13
 * Author: Gemini
 *
 * Change Log:
 * - [UX Polish] Sorted CORE contacts by update time, added '最後更新' column and UI hint.
 * - [Bugfix] Implemented multi-page fetching loop for CORE contacts to ensure all SQL rows are loaded into the frontend.
 * - [Feature] Added "正式聯絡人" tab to view CORE (SQL) contacts in read-only mode.
 * - [Feature] Integrated /api/contacts/list API fetch into the page load flow.
 * - [Feature] Split search logic to support `company` (RAW) vs `companyName` (CORE).
 * - [UI Polish] Enlarged tabs, simplified header, improved search placeholder, and added result count.
 * - [UI Simplification] Removed Contacts Trend Chart and related dashboard fetch logic.
 * - [UX Patch] Added "項次" (index) column to the "名片列表" view.
 * - [UX Patch] Made "姓名" (name) an editable field in the RAW contact edit form.
 * - [Bugfix] Fixed `query.toLowerCase is not a function` crash by adding string type guards for routing params.
 * - [Bugfix] Fixed tab UI state resetting to "聯絡人列表" after saving an edit by binding DOM tab state to `currentContactsTab`.
 * - [Bugfix] Added `e.preventDefault()` in action handler to prevent unexpected UI jumps.
 * - [Phase 8.1] Removed "升級" (Upgrade to Opportunity) feature from RAW contacts page.
 * - [Phase 8.1] Ensured contact names are always fully visible (removed truncation).
 * - [Phase 8.1] Added "名片總覽" (Business Card List) tab.
 * - [Phase 8.1] Implemented inline edit mode for RAW contacts (Left: Preview, Right: Form).
 * - [Phase 8.1] Wired edit form to PUT /api/contacts/:rowIndex/raw.
 * * WORLD MODEL (UI LAYER):
 * 1. RAW Contact (Potential):
 * - Rendered here (loadContacts) in "聯絡人列表" & "名片總覽" tabs.
 * - Source: /api/contacts (Sheet Read).
 * - Action: View Card, Edit Card.
 * - Identity: Uses rowIndex (passed in payload) for handoff to update API.
 * 2. CORE Contact (Official):
 * - Rendered here in "正式聯絡人" tab (Read-Only).
 * - Source: /api/contacts/list (SQL Read - Multi-page accumulation).
 * - Identity: contactId.
 * ============================================================================
 */

// ==================== 全域變數 ====================
let allContactsData = []; 
let coreContactsData = [];
let currentContactsTab = 'list'; // 'list' | 'cards' | 'core'
let currentEditRowIndex = null;

// ==================== 主要功能函式 ====================

async function loadContacts(query = '') {
    const container = document.getElementById('page-contacts');
    if (!container) return;

    // Type Guard: Ensure query is a string (Router may pass a params object)
    const searchQuery = typeof query === 'string' ? query : '';

    // Determine active tab state
    const isListActive = currentContactsTab === 'list';
    const isCardsActive = currentContactsTab === 'cards';
    const isCoreActive = currentContactsTab === 'core';

    // 1. 初始化容器與事件監聽 (加入頁籤 UI)
    container.innerHTML = `
        <div class="dashboard-widget">
            <div class="widget-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 15px;">
                <div style="display: flex; align-items: baseline; gap: 15px;">
                    <h2 class="widget-title" style="margin: 0;">潛在客戶</h2>
                </div>
                <div class="contacts-tabs" style="display: flex; gap: 4px; background: var(--bg-hover, #f1f5f9); padding: 4px; border-radius: 8px;">
                    <button class="tab-btn ${isListActive ? 'active' : ''}" data-action="switch-tab" data-tab="list" style="background: ${isListActive ? 'white' : 'transparent'}; border: none; padding: 8px 16px; font-weight: ${isListActive ? '600' : '500'}; color: ${isListActive ? 'var(--accent-blue)' : 'var(--text-muted)'}; border-radius: 6px; box-shadow: ${isListActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}; cursor: pointer; transition: all 0.2s;">聯絡人列表</button>
                    <button class="tab-btn ${isCardsActive ? 'active' : ''}" data-action="switch-tab" data-tab="cards" style="background: ${isCardsActive ? 'white' : 'transparent'}; border: none; padding: 8px 16px; font-weight: ${isCardsActive ? '600' : '500'}; color: ${isCardsActive ? 'var(--accent-blue)' : 'var(--text-muted)'}; border-radius: 6px; box-shadow: ${isCardsActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}; cursor: pointer; transition: all 0.2s;">名片總覽</button>
                    <button class="tab-btn ${isCoreActive ? 'active' : ''}" data-action="switch-tab" data-tab="core" style="background: ${isCoreActive ? 'white' : 'transparent'}; border: none; padding: 8px 16px; font-weight: ${isCoreActive ? '600' : '500'}; color: ${isCoreActive ? 'var(--accent-blue)' : 'var(--text-muted)'}; border-radius: 6px; box-shadow: ${isCoreActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}; cursor: pointer; transition: all 0.2s;">正式聯絡人</button>
                </div>
            </div>
            
            <div id="contacts-action-bar" style="padding: 1.5rem 1.5rem 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 15px;">
                    <div class="search-pagination" style="flex: 1;">
                        <input type="text" class="search-box" id="contacts-page-search" placeholder="搜尋姓名 / 公司" value="${searchQuery}" style="width: 100%; max-width: 400px;">
                    </div>
                    <div id="contacts-count-display" style="font-size: 0.9rem; color: var(--text-muted); font-weight: 500;"></div>
                </div>
            </div>

            <div id="contacts-page-content" style="padding: 0 1.5rem 1.5rem;">
                <div class="loading show"><div class="spinner"></div><p>載入客戶資料中...</p></div>
            </div>
        </div>
    `;

    // 移除舊監聽器並綁定新的 (事件委派核心)
    container.removeEventListener('click', handleContactListClick);
    container.addEventListener('click', handleContactListClick);

    // 綁定搜尋輸入
    const searchInputEl = document.getElementById('contacts-page-search');
    if (searchInputEl) {
        searchInputEl.addEventListener('keyup', searchContactsEvent);
    }

    try {
        if (allContactsData.length === 0 || coreContactsData.length === 0) {
            console.log('[Contacts] 首次載入，正在獲取潛在與正式客戶資料...');
            
            // Helper function to fetch all paginated CORE contacts
            const fetchAllCoreContacts = async () => {
                let accumulatedData = [];
                let currentPage = 1;
                let hasNext = true;
                
                while (hasNext) {
                    const res = await authedFetch(`/api/contacts/list?page=${currentPage}&limit=100`); // using 100 to be safe with standard pagination bounds
                    if (res && res.data) {
                        accumulatedData = accumulatedData.concat(res.data);
                    }
                    if (res && res.pagination && res.pagination.hasNext) {
                        currentPage++;
                    } else {
                        hasNext = false;
                    }
                }
                return accumulatedData;
            };

            // [World Model] Fetching RAW Data and CORE Data in parallel
            const [listResult, fullCoreData] = await Promise.all([
                authedFetch(`/api/contacts?q=`),
                fetchAllCoreContacts()
            ]);
            
            allContactsData = listResult.data || [];
            coreContactsData = fullCoreData || [];
        }
        
        filterAndRenderContacts(searchQuery);

    } catch (error) {
        if (error.message !== 'Unauthorized') {
            const listContent = document.getElementById('contacts-page-content');
            if(listContent) listContent.innerHTML = `<div class="alert alert-error">載入資料失敗: ${error.message}</div>`;
        }
    }
}

// --- 事件處理中心 (Central Handler) ---

function handleContactListClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    e.preventDefault(); // Prevent accidental form submits or jumping

    const action = btn.dataset.action;
    const payload = btn.dataset;

    switch (action) {
        case 'view-card':
            // 呼叫外部全域函式 (假設存在於 main.js 或 utils.js)
            if (window.showBusinessCardPreview) {
                window.showBusinessCardPreview(payload.link);
            } else {
                console.warn('showBusinessCardPreview function not found');
            }
            break;
            
        case 'switch-tab':
            const tabName = payload.tab;
            if (currentContactsTab === tabName) return; // No change
            
            // Update UI state
            currentContactsTab = tabName;
            document.querySelectorAll('.contacts-tabs .tab-btn').forEach(t => {
                t.classList.remove('active');
                t.style.fontWeight = '500';
                t.style.color = 'var(--text-muted)';
                t.style.background = 'transparent';
                t.style.boxShadow = 'none';
            });
            btn.classList.add('active');
            btn.style.fontWeight = '600';
            btn.style.color = 'var(--accent-blue)';
            btn.style.background = 'white';
            btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            
            // Re-apply current search
            const currentQuery = document.getElementById('contacts-page-search')?.value || '';
            filterAndRenderContacts(currentQuery);
            break;

        case 'edit-card':
            try {
                const contactData = JSON.parse(payload.contact);
                renderEditCardMode(contactData);
            } catch (err) {
                console.error('無法解析聯絡人資料進行編輯', err);
            }
            break;

        case 'cancel-edit':
            // Return to current tab view
            const query = document.getElementById('contacts-page-search')?.value || '';
            filterAndRenderContacts(query);
            break;
            
        case 'save-edit':
            handleSaveCardEdit();
            break;
    }
}

function searchContactsEvent(event) {
    const query = event.target.value;
    handleSearch(() => filterAndRenderContacts(query));
}

function filterAndRenderContacts(query = '') {
    const listContent = document.getElementById('contacts-page-content');
    const actionBar = document.getElementById('contacts-action-bar');
    const countDisplay = document.getElementById('contacts-count-display');
    if (!listContent) return;

    // Ensure search bar is visible when not in edit mode
    if (actionBar) actionBar.style.display = 'block';
    currentEditRowIndex = null; // Reset edit state

    let filteredData = [];
    
    // Type Guard: strictly handle query as a string
    const safeQuery = typeof query === 'string' ? query : '';
    const searchTerm = safeQuery.toLowerCase();

    // Branch filtering based on active tab and data source
    if (currentContactsTab === 'core') {
        filteredData = [...coreContactsData];
        if (searchTerm) {
            filteredData = filteredData.filter(c =>
                (c.name && c.name.toLowerCase().includes(searchTerm)) ||
                (c.companyName && c.companyName.toLowerCase().includes(searchTerm))
            );
        }
        // [UX Polish] Sort CORE contacts by update time descending
        filteredData.sort((a, b) => {
            const timeA = new Date(a.lastUpdateTime || a.createdTime || 0).getTime();
            const timeB = new Date(b.lastUpdateTime || b.createdTime || 0).getTime();
            return timeB - timeA;
        });
    } else {
        filteredData = [...allContactsData];
        if (searchTerm) {
            filteredData = filteredData.filter(c =>
                (c.name && c.name.toLowerCase().includes(searchTerm)) ||
                (c.company && c.company.toLowerCase().includes(searchTerm))
            );
        }
    }
    
    // Update count display with appropriate label and hint
    if (countDisplay) {
        const label = currentContactsTab === 'core' ? '正式聯絡人' : '潛在客戶';
        let htmlContent = `共 ${filteredData.length} 筆${label}`;
        
        if (currentContactsTab === 'core') {
            htmlContent += ` <span style="margin-left: 10px; font-size: 0.85em; background: var(--bg-hover, #f1f5f9); padding: 3px 8px; border-radius: 4px; color: var(--text-secondary);">「依最後更新時間排序（新到舊）」</span>`;
        }
        
        countDisplay.innerHTML = htmlContent;
    }

    // Render corresponding view
    if (currentContactsTab === 'list') {
        listContent.innerHTML = renderContactsTable(filteredData);
    } else if (currentContactsTab === 'cards') {
        listContent.innerHTML = renderBusinessCardList(filteredData);
    } else if (currentContactsTab === 'core') {
        listContent.innerHTML = renderCoreContactsTable(filteredData);
    }
}

// ==================== 專用渲染函式 ====================

// --- Tab 1: 聯絡人列表 (RAW) ---
function renderContactsTable(data) {
    if (!data || data.length === 0) {
        return '<div class="alert alert-info" style="text-align:center; margin-top: 20px;">沒有找到聯絡人資料</div>';
    }

    // Add specific style to ensure name wraps and does not truncate
    let listHTML = `
        <style>
            .contact-card-name-full {
                font-weight: 600;
                font-size: 1.1rem;
                color: var(--text-main);
                white-space: normal; /* Force wrap */
                word-break: break-all; /* Prevent overflow on long strings without spaces */
                display: block;
                line-height: 1.4;
            }
        </style>
        <div class="contact-card-list">
    `;

    data.forEach(contact => {
        const isUpgraded = contact.status === '已升級';
        const isArchived = contact.status === '已歸檔';
        const isFiled = contact.status === '已建檔';

        const safeDriveLink = contact.driveLink ? contact.driveLink.replace(/'/g, "\\'") : '';

        const driveLinkBtn = contact.driveLink
            ? `<button class="action-btn small info" title="預覽名片" data-action="view-card" data-link="${safeDriveLink}">💳 名片</button>`
            : '';

        let statusBadge = '';
        if (isUpgraded) {
            statusBadge = `<span class="contact-card-status upgraded">已升級</span>`;
        } else if (isArchived) {
            statusBadge = `<span class="contact-card-status archived">已歸檔</span>`;
        } else if (isFiled) {
            statusBadge = `<span class="contact-card-status filed">已建檔</span>`;
        } else { 
            statusBadge = `<span class="contact-card-status pending">待處理</span>`;
        }

        listHTML += `
            <div class="contact-card">
                <div class="contact-card-main">
                    <div class="contact-card-header" style="align-items: flex-start; margin-bottom: 8px;">
                        <span class="contact-card-name-full">${contact.name || '(無姓名)'}</span>
                        <div style="margin-left: 10px; flex-shrink: 0;">${statusBadge}</div>
                    </div>
                    <div class="contact-card-company">${contact.company || '(無公司)'}</div>
                    <div class="contact-card-position">${contact.position || '(無職位)'}</div>
                </div>
                <div class="contact-card-actions">
                    ${driveLinkBtn}
                </div>
            </div>
        `;
    });
    listHTML += '</div>';
    return listHTML;
}

// --- Tab 2: 名片總覽 (RAW) ---
function renderBusinessCardList(data) {
    if (!data || data.length === 0) {
        return '<div class="alert alert-info" style="text-align:center; margin-top: 20px;">沒有找到名片資料</div>';
    }

    let listHTML = `
        <style>
            .bc-list-table { width: 100%; border-collapse: collapse; min-width: 800px; }
            .bc-list-table th, .bc-list-table td { padding: 12px; border-bottom: 1px solid var(--border-color); text-align: left; vertical-align: middle; }
            .bc-list-table th { background-color: var(--glass-bg); color: var(--text-secondary); font-weight: 600; }
            .bc-list-table tr:hover { background-color: var(--bg-hover, #f8fafc); }
            .bc-name-cell { font-weight: 600; color: var(--text-main); white-space: normal; word-break: break-all; }
        </style>
        <div style="overflow-x: auto;">
            <table class="bc-list-table">
                <thead>
                    <tr>
                        <th style="width: 60px; text-align: center;">項次</th>
                        <th>姓名</th>
                        <th>公司</th>
                        <th>職位</th>
                        <th>手機</th>
                        <th>Email</th>
                        <th style="text-align: right;">操作</th>
                    </tr>
                </thead>
                <tbody>
    `;

    data.forEach((contact, index) => {
        const contactJsonString = JSON.stringify(contact).replace(/'/g, "&apos;").replace(/"/g, '&quot;');
        const safeDriveLink = contact.driveLink ? contact.driveLink.replace(/'/g, "\\'") : '';
        
        const previewBtn = contact.driveLink 
            ? `<button class="action-btn small info" title="預覽名片" data-action="view-card" data-link="${safeDriveLink}" style="margin-right: 8px;">💳</button>`
            : '';

        listHTML += `
            <tr>
                <td style="text-align: center; color: var(--text-muted); font-weight: 500;">${index + 1}</td>
                <td class="bc-name-cell">${contact.name || '-'}</td>
                <td>${contact.company || '-'}</td>
                <td>${contact.position || '-'}</td>
                <td>${contact.mobile || '-'}</td>
                <td>${contact.email || '-'}</td>
                <td style="text-align: right; white-space: nowrap;">
                    ${previewBtn}
                    <button class="action-btn small primary" data-action="edit-card" data-contact='${contactJsonString}'>✏️ 編輯</button>
                </td>
            </tr>
        `;
    });

    listHTML += `
                </tbody>
            </table>
        </div>
    `;
    return listHTML;
}

// --- Tab 3: 正式聯絡人 (CORE - Read Only) ---
function renderCoreContactsTable(data) {
    if (!data || data.length === 0) {
        return '<div class="alert alert-info" style="text-align:center; margin-top: 20px;">沒有找到正式聯絡人資料</div>';
    }

    let listHTML = `
        <style>
            .core-list-table { width: 100%; border-collapse: collapse; min-width: 800px; }
            .core-list-table th, .core-list-table td { padding: 12px; border-bottom: 1px solid var(--border-color); text-align: left; vertical-align: middle; }
            .core-list-table th { background-color: var(--glass-bg); color: var(--text-secondary); font-weight: 600; }
            .core-list-table tr:hover { background-color: var(--bg-hover, #f8fafc); }
            .core-name-cell { font-weight: 600; color: var(--text-main); white-space: normal; word-break: break-all; }
        </style>
        <div style="overflow-x: auto;">
            <table class="core-list-table">
                <thead>
                    <tr>
                        <th style="width: 60px; text-align: center;">項次</th>
                        <th>姓名</th>
                        <th>公司</th>
                        <th>職位</th>
                        <th>手機</th>
                        <th>Email</th>
                        <th>最後更新</th>
                    </tr>
                </thead>
                <tbody>
    `;

    data.forEach((contact, index) => {
        let updateTimeStr = '-';
        const rawTime = contact.lastUpdateTime || contact.createdTime;
        if (rawTime) {
            const d = new Date(rawTime);
            if (!isNaN(d.getTime())) {
                updateTimeStr = d.toLocaleDateString('zh-TW');
            }
        }

        listHTML += `
            <tr>
                <td style="text-align: center; color: var(--text-muted); font-weight: 500;">${index + 1}</td>
                <td class="core-name-cell">${contact.name || '-'}</td>
                <td>${contact.companyName || '-'}</td>
                <td>${contact.position || '-'}</td>
                <td>${contact.mobile || '-'}</td>
                <td>${contact.email || '-'}</td>
                <td style="color: var(--text-muted); font-size: 0.9em;">${updateTimeStr}</td>
            </tr>
        `;
    });

    listHTML += `
                </tbody>
            </table>
        </div>
    `;
    return listHTML;
}

// --- Edit Mode (Left Image / Right Form) ---
function renderEditCardMode(contact) {
    const listContent = document.getElementById('contacts-page-content');
    const actionBar = document.getElementById('contacts-action-bar');
    if (!listContent) return;

    // Hide search bar during edit
    if (actionBar) actionBar.style.display = 'none';
    currentEditRowIndex = contact.rowIndex;

    let imagePreviewHtml = '';
    if (contact.driveLink) {
        const proxyUrl = `/api/drive/thumbnail?link=${encodeURIComponent(contact.driveLink)}`;
        imagePreviewHtml = `
            <a href="${contact.driveLink}" target="_blank" title="點擊開啟原始檔案 (Google Drive)" style="display: block; text-align: center; cursor: zoom-in;">
                <img src="${proxyUrl}" alt="名片預覽" style="max-width: 100%; max-height: 60vh; object-fit: contain; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid var(--border-color);" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'alert alert-warning\\'>預覽載入失敗，可點擊查看原檔</div>';">
            </a>
            <div style="text-align: center; margin-top: 8px;"><small style="color: var(--text-muted);">點擊圖片可開啟原檔</small></div>
        `;
    } else {
        imagePreviewHtml = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 300px; background-color: var(--glass-bg); border-radius: 8px; border: 1px dashed var(--border-color); color: var(--text-muted);">
                <span style="font-size: 3rem; margin-bottom: 1rem;">📇</span>
                <p>無名片圖檔</p>
            </div>
        `;
    }

    // Editable fields: name, company, position, mobile, email
    const safeName = (contact.name || '').replace(/"/g, '&quot;');
    const safeCompany = (contact.company || '').replace(/"/g, '&quot;');
    const safePosition = (contact.position || '').replace(/"/g, '&quot;');
    const safeMobile = (contact.mobile || '').replace(/"/g, '&quot;');
    const safeEmail = (contact.email || '').replace(/"/g, '&quot;');

    listContent.innerHTML = `
        <div class="edit-card-container" style="display: flex; gap: 2rem; align-items: flex-start; flex-wrap: wrap;">
            
            <div class="edit-card-preview" style="flex: 1; min-width: 300px;">
                <h3 style="margin-bottom: 1rem; font-size: 1.1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">名片預覽</h3>
                ${imagePreviewHtml}
            </div>

            <div class="edit-card-form" style="flex: 1; min-width: 300px; background: var(--card-bg, #fff); padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
                    <h3 style="font-size: 1.1rem; margin: 0;">編輯聯絡人資訊</h3>
                </div>

                <div class="form-group" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; color: var(--text-secondary);">姓名</label>
                    <input type="text" id="raw-edit-name" class="form-input" value="${safeName}" style="width: 100%;">
                </div>

                <div class="form-group" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; color: var(--text-secondary);">公司名稱</label>
                    <input type="text" id="raw-edit-company" class="form-input" value="${safeCompany}" style="width: 100%;">
                </div>
                
                <div class="form-group" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; color: var(--text-secondary);">職稱 (Position)</label>
                    <input type="text" id="raw-edit-position" class="form-input" value="${safePosition}" style="width: 100%;">
                </div>

                <div class="form-group" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; color: var(--text-secondary);">手機 (Mobile)</label>
                    <input type="tel" id="raw-edit-mobile" class="form-input" value="${safeMobile}" style="width: 100%;">
                </div>

                <div class="form-group" style="margin-bottom: 2rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500; color: var(--text-secondary);">信箱 (Email)</label>
                    <input type="email" id="raw-edit-email" class="form-input" value="${safeEmail}" style="width: 100%;">
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="action-btn" data-action="cancel-edit" style="background: var(--glass-bg); color: var(--text-main); border: 1px solid var(--border-color);">取消</button>
                    <button class="action-btn primary" data-action="save-edit" id="btn-save-raw-edit">儲存變更</button>
                </div>
            </div>

        </div>
    `;
}

// --- Save Action ---
async function handleSaveCardEdit() {
    if (!currentEditRowIndex) {
        console.error('Missing rowIndex for save.');
        if (typeof showNotification === 'function') showNotification('無法儲存：缺少資料識別碼', 'error');
        return;
    }

    const btn = document.getElementById('btn-save-raw-edit');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '儲存中...';
    }

    const payload = {
        name: document.getElementById('raw-edit-name')?.value.trim() || '',
        company: document.getElementById('raw-edit-company')?.value.trim() || '',
        position: document.getElementById('raw-edit-position')?.value.trim() || '',
        mobile: document.getElementById('raw-edit-mobile')?.value.trim() || '',
        email: document.getElementById('raw-edit-email')?.value.trim() || ''
    };

    try {
        const response = await authedFetch(`/api/contacts/${currentEditRowIndex}/raw`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        if (response && response.success) {
            if (typeof showNotification === 'function') showNotification('資料已更新成功', 'success');
            
            // Re-fetch data to reflect changes immediately
            const listResult = await authedFetch(`/api/contacts?q=`);
            if (listResult && listResult.data) {
                allContactsData = listResult.data;
            }
            
            // Exit edit mode and return to previous list view safely
            currentEditRowIndex = null;
            const safeQuery = document.getElementById('contacts-page-search')?.value || '';
            filterAndRenderContacts(safeQuery);
            
            // Signal dashboard update. 
            // Note: If refreshCurrentView clears the DOM, the new logic in loadContacts ensures 
            // the tabs correctly respect currentContactsTab, keeping the user in the cards view.
            if (window.dashboardManager && typeof window.dashboardManager.markStale === 'function') {
                window.dashboardManager.markStale();
            }

        } else {
            throw new Error(response.error || '更新失敗');
        }
    } catch (error) {
        console.error('Save raw contact failed:', error);
        if (typeof showNotification === 'function') {
            showNotification(`儲存失敗: ${error.message}`, 'error');
        } else {
            alert(`儲存失敗: ${error.message}`);
        }
        if (btn) {
            btn.disabled = false;
            btn.textContent = '儲存變更';
        }
    }
}

if (window.CRM_APP) {
    if (!window.CRM_APP.pageModules) window.CRM_APP.pageModules = {};
    window.CRM_APP.pageModules.contacts = loadContacts;
}
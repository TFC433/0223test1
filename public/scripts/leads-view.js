// File: public/scripts/leads-view.js
// Version: 15.3.0
// Date: 2026-03-20
// Changelog: 
//   - V6.3 Refinement: Moved top-right control pills out of item-image to v6-list-item root.
//   - Retained V6.1 edit button wording and V6.2 ratio fixes.
// Description: Logic controller for Lead View V6.3 (Reading Structure + Desktop Pill Position).

let allLeads = [];
let currentUser = {
    userId: null,
    displayName: '訪客',
    pictureUrl: null
};
let currentView = 'all'; 

document.addEventListener('DOMContentLoaded', async () => {
    toggleContentVisibility(false);
    await initLIFF();
    bindEvents();
});

function toggleContentVisibility(show) {
    const controls = document.querySelector('.controls-section');
    const main = document.querySelector('.leads-container');
    const loginPrompt = document.getElementById('login-prompt'); 

    if (show) {
        if(controls) controls.style.display = 'flex';
        if(main) main.style.display = 'block';
        if(loginPrompt) loginPrompt.style.display = 'none';
    } else {
        if(controls) controls.style.display = 'none';
        if(main) main.style.display = 'none';
        if (!loginPrompt) createLoginPrompt();
        else loginPrompt.style.display = 'flex';
    }
}

function createLoginPrompt() {
    const promptDiv = document.createElement('div');
    promptDiv.id = 'login-prompt';
    promptDiv.className = 'empty-state'; 
    promptDiv.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; padding: 20px; text-align: center;';
    
    promptDiv.innerHTML = `
        <div class="empty-icon" style="font-size: 5rem; margin-bottom: 20px;">🔒</div>
        <h2 style="margin-bottom: 10px; color: var(--text-main);">請先登入</h2>
        <p style="color: var(--text-sub); margin-bottom: 20px;">此頁面僅限授權成員存取<br>請點擊右上角或下方的按鈕登入 LINE</p>
        <button class="login-btn" onclick="liff.login()" style="padding: 10px 30px; font-size: 1rem;">LINE 登入</button>
    `;
    
    const header = document.querySelector('.main-header');
    if(header && header.parentNode) {
        header.parentNode.insertBefore(promptDiv, header.nextSibling);
    }
}

function showAccessDenied(userId) {
    const promptDiv = document.getElementById('login-prompt');
    if (promptDiv) {
        promptDiv.innerHTML = `
            <div class="empty-icon" style="font-size: 5rem; margin-bottom: 20px; color: var(--accent-red, #ef4444);">⛔</div>
            <h2 style="margin-bottom: 10px; color: var(--text-main);">未授權的帳號</h2>
            <p style="color: var(--text-sub); margin-bottom: 20px;">
                您的 LINE ID 尚未被加入系統白名單。<br>
                請複製下方 ID 並傳送給管理員申請開通：
            </p>
            <div style="background: #f1f5f9; padding: 10px; border-radius: 8px; font-family: monospace; user-select: all; margin-bottom: 20px;">
                ${userId}
            </div>
            <button class="action-btn" onclick="liff.logout(); location.reload();" style="width: auto; padding: 10px 20px;">登出並切換帳號</button>
        `;
        promptDiv.style.display = 'flex';
    }
}

async function initLIFF() {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

    if (isLocal) {
        console.warn('🛠️ [Dev] 本地模式，使用測試帳號');
        currentUser.userId = 'TEST_LOCAL_USER';
        currentUser.displayName = '測試員 (Local)';
        updateUserUI(true);
        loadLeadsData(); 
        return; 
    }

    try {
        if (typeof liff === 'undefined' || !LIFF_ID) {
            console.error('LIFF 未就緒');
            return;
        }
        
        await liff.init({ liffId: LIFF_ID });
        
        if (liff.isLoggedIn()) {
            const profile = await liff.getProfile();
            currentUser.userId = profile.userId;
            currentUser.displayName = profile.displayName;
            currentUser.pictureUrl = profile.pictureUrl;
            updateUserUI(true);
            
            loadLeadsData();
        } else {
            updateUserUI(false);
            toggleContentVisibility(false);
        }
    } catch (error) {
        console.error('LIFF Init Error:', error);
        toggleContentVisibility(false);
    }
}

function updateUserUI(isLoggedIn) {
    const userArea = document.getElementById('user-area');
    const loginBtn = document.getElementById('login-btn');
    
    if (isLoggedIn) {
        userArea.style.display = 'flex';
        loginBtn.style.display = 'none';
        
        document.getElementById('user-name').textContent = `你好，${currentUser.displayName}`;
        
        if (currentUser.pictureUrl) {
            document.getElementById('user-avatar').src = currentUser.pictureUrl;
            document.getElementById('user-avatar').style.display = 'block';
        }
    } else {
        userArea.style.display = 'none';
        loginBtn.style.display = 'block';
    }
}

function bindEvents() {
    document.getElementById('login-btn').onclick = () => {
        if (typeof liff !== 'undefined' && LIFF_ID) liff.login();
    };

    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentView = btn.dataset.view; 
            renderLeads();
        };
    });

    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearBtn.style.display = e.target.value ? 'flex' : 'none';
            renderLeads();
        });
    }
    if (clearBtn) {
        clearBtn.onclick = () => {
            searchInput.value = '';
            clearBtn.style.display = 'none';
            renderLeads();
        };
    }

    document.querySelectorAll('.close-modal').forEach(el => {
        el.onclick = () => {
            document.getElementById('preview-modal').style.display = 'none';
            document.getElementById('edit-modal').style.display = 'none';
        };
    });
    
    window.onclick = (e) => { 
        if (e.target.classList.contains('modal')) e.target.style.display = 'none'; 
    };

    const editForm = document.getElementById('edit-form');
    if (editForm) editForm.onsubmit = handleEditSubmit;
}

async function loadLeadsData() {
    const loadingEl = document.getElementById('loading-indicator');
    const gridEl = document.getElementById('leads-grid');
    
    if (!currentUser.userId) return;

    toggleContentVisibility(true); 
    if(loadingEl) loadingEl.style.display = 'block';
    if(gridEl) gridEl.style.display = 'none';
    
    try {
        const headers = { 
            'Content-Type': 'application/json'
        };

        if (currentUser.userId === 'TEST_LOCAL_USER') {
            headers['Authorization'] = 'Bearer TEST_LOCAL_TOKEN';
        } else {
            const idToken = liff.getIDToken();
            if (idToken) {
                headers['Authorization'] = `Bearer ${idToken}`;
            } else {
                console.warn('無法取得 LIFF ID Token');
            }
        }

        const response = await fetch('/api/line/leads', { headers });
        const result = await response.json();
        
        if (response.status === 403) {
            toggleContentVisibility(false);
            showAccessDenied(result.yourUserId);
            return;
        }

        if (response.status === 401) {
            alert('登入驗證失敗，請重新登入 LINE');
            console.error('[Auth] 401 Unauthorized');
            return;
        }

        if (result.success) {
            allLeads = result.data;
            if(loadingEl) loadingEl.style.display = 'none';
            if(gridEl) gridEl.style.display = 'flex'; 
            updateCounts();
            renderLeads();
        } else {
            throw new Error(result.message || '資料載入失敗');
        }
    } catch (error) {
        console.error(error);
        if(loadingEl) loadingEl.innerHTML = `<p style="color:red">發生錯誤: ${error.message}</p>`;
    }
}

function updateCounts() {
    document.getElementById('count-all').textContent = allLeads.length;
    
    const myCount = allLeads.filter(l => l.lineUserId === currentUser.userId).length;
    document.getElementById('count-mine').textContent = myCount;
    
    const pendingCount = allLeads.filter(l => {
        const hasName = l.name && l.name.trim() !== '';
        const hasCompany = l.company && l.company.trim() !== '';
        return !hasName || !hasCompany;
    }).length;
    document.getElementById('count-pending').textContent = pendingCount;
}

function renderLeads() {
    const grid = document.getElementById('leads-grid');
    const emptyState = document.getElementById('empty-state');
    const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();

    if (!grid) return;

    let filtered = allLeads.filter(lead => {
        const hasName = lead.name && lead.name.trim() !== '';
        const hasCompany = lead.company && lead.company.trim() !== '';
        const isPending = !hasName || !hasCompany;

        if (currentView === 'mine' && lead.lineUserId !== currentUser.userId) return false;
        if (currentView === 'pending' && !isPending) return false;

        if (searchTerm) {
            const text = `${lead.name} ${lead.company} ${lead.position}`.toLowerCase();
            return text.includes(searchTerm);
        }
        return true;
    });

    if (filtered.length === 0) {
        grid.style.display = 'none';
        if(emptyState) emptyState.style.display = 'block';
        return;
    }

    grid.style.display = 'flex'; 
    if(emptyState) emptyState.style.display = 'none';
    grid.innerHTML = filtered.map(lead => createCardHTML(lead)).join('');
}

function createCardHTML(lead) {
    const isMine = (lead.lineUserId === currentUser.userId);
    
    const hasName = lead.name && lead.name.trim() !== '';
    const hasCompany = lead.company && lead.company.trim() !== '';
    
    let missingText = '';
    if (!hasName && !hasCompany) missingText = '缺姓名 + 公司';
    else if (!hasName) missingText = '缺姓名';
    else if (!hasCompany) missingText = '缺公司';

    const safe = (str) => (str || '').replace(/"/g, '&quot;');
    const safeHtml = (str) => (str || '').replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const leadJson = JSON.stringify(lead).replace(/'/g, "&apos;").replace(/"/g, "&quot;");

    const isLocalDev = (currentUser.userId === 'TEST_LOCAL_USER');
    const showEditBtn = isLocalDev || isMine;

    const ownerName = lead.userNickname || 'Unknown';
    const ownerText = isMine ? `👤 我的` : `👤 ${ownerName}`;
    
    const statusBadgeHtml = missingText 
        ? `<span class="badge warning-badge badge-top-left">⚠ ${missingText}</span>` 
        : '';

    const imageUrl = lead.driveLink && lead.driveLink !== 'undefined' && lead.driveLink !== 'null'
        ? `/api/drive/thumbnail?link=${encodeURIComponent(lead.driveLink)}`
        : null;

    const imageHtml = imageUrl 
        ? `<img src="${imageUrl}" alt="名片" loading="lazy" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'placeholder\\'>📇</div>';">`
        : `<div class="placeholder">📇</div>`;

    // V6.3 HTML Structure Change: image-top-right moved outside item-image
    return `
        <div class="v6-list-item ${isMine ? 'is-mine' : ''}">
            <div class="image-top-right">
                <div class="owner-tag">${safeHtml(ownerText)}</div>
                ${showEditBtn ? `<button class="edit-pill-btn" onclick='event.stopPropagation(); openEdit(${leadJson})'>✏️ 編輯</button>` : ''}
            </div>
            
            <div class="item-image" onclick='openPreview("${safe(lead.driveLink)}")' title="點擊看原圖">
                ${statusBadgeHtml}
                ${imageHtml}
            </div>
            
            <div class="item-info">
                <div class="identity-zone">
                    <div class="info-name ${!hasName ? 'text-missing' : ''}">${hasName ? safeHtml(lead.name) : '未命名'}</div>
                    <div class="company-row">
                        ${lead.company ? `<span class="company-pill">${safeHtml(lead.company)}</span>` : ''}
                        ${lead.position ? `<span class="position-text">${safeHtml(lead.position)}</span>` : ''}
                    </div>
                </div>
                
                <div class="info-body">
                    ${lead.mobile ? `<div class="info-line">📱 ${safeHtml(lead.mobile)}</div>` : ''}
                    ${lead.email ? `<div class="info-line">📧 ${safeHtml(lead.email)}</div>` : ''}
                </div>
            </div>
        </div>
    `;
}

function openPreview(driveLink) {
    if (!driveLink || driveLink === 'undefined' || driveLink === 'null') { 
        alert('此名片沒有圖片連結'); 
        return; 
    }
    
    const modal = document.getElementById('preview-modal');
    const container = document.getElementById('preview-image-container');
    const downloadLink = document.getElementById('preview-download-link');
    
    modal.style.display = 'block';
    container.innerHTML = '<div class="spinner"></div>';
    
    const previewUrl = `/api/drive/thumbnail?link=${encodeURIComponent(driveLink)}`;
    const img = new Image();
    
    img.onload = () => {
        container.innerHTML = '';
        container.appendChild(img);
    };
    
    img.onerror = () => {
        console.error('名片預覽載入失敗');
        container.innerHTML = '<p style="color:red">圖片無法載入</p>';
    };
    
    img.src = previewUrl;
    img.alt = "名片預覽";
    downloadLink.href = driveLink;
}

function openEdit(lead) {
    const modal = document.getElementById('edit-modal');
    
    let previewContainer = document.getElementById('edit-preview-container');
    if (!previewContainer) {
        previewContainer = document.createElement('div');
        previewContainer.id = 'edit-preview-container';
        previewContainer.className = 'edit-preview';
        const form = document.getElementById('edit-form');
        form.insertBefore(previewContainer, form.firstChild);
    }
    
    if (lead.driveLink && lead.driveLink !== 'undefined' && lead.driveLink !== 'null') {
        const previewUrl = `/api/drive/thumbnail?link=${encodeURIComponent(lead.driveLink)}`;
        previewContainer.innerHTML = `<img src="${previewUrl}" alt="名片預覽" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'placeholder\\'>📇</div>';">`;
    } else {
        previewContainer.innerHTML = `<div class="placeholder">📇</div>`;
    }

    document.getElementById('edit-rowIndex').value = lead.rowIndex;
    document.getElementById('edit-name').value = lead.name || '';
    document.getElementById('edit-position').value = lead.position || '';
    document.getElementById('edit-company').value = lead.company || '';
    document.getElementById('edit-mobile').value = lead.mobile || '';
    document.getElementById('edit-email').value = lead.email || '';
    document.getElementById('edit-notes').value = ''; 
    modal.style.display = 'block';
}

async function handleEditSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '儲存中...';

    const rowIndex = document.getElementById('edit-rowIndex').value;
    const data = {
        name: document.getElementById('edit-name').value,
        position: document.getElementById('edit-position').value,
        company: document.getElementById('edit-company').value,
        mobile: document.getElementById('edit-mobile').value,
        email: document.getElementById('edit-email').value,
        modifier: currentUser.displayName 
    };
    
    const notes = document.getElementById('edit-notes').value.trim();
    if (notes) data.notes = notes;

    try {
        const headers = { 
            'Content-Type': 'application/json'
        };

        if (currentUser.userId === 'TEST_LOCAL_USER') {
            headers['Authorization'] = 'Bearer TEST_LOCAL_TOKEN';
        } else {
            const idToken = liff.getIDToken();
            if (idToken) {
                headers['Authorization'] = `Bearer ${idToken}`;
            }
        }

        const res = await fetch(`/api/line/leads/${rowIndex}`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(data)
        });
        
        if (res.status === 403) {
            alert('您沒有權限執行此操作');
            return;
        }

        if (res.status === 401) {
            alert('登入憑證已過期');
            return;
        }

        const result = await res.json();
        
        if (result.success) {
            alert('更新成功！');
            document.getElementById('edit-modal').style.display = 'none';
            loadLeadsData();
        } else {
            alert('更新失敗: ' + result.error);
        }
    } catch (e) {
        alert('網路錯誤');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}
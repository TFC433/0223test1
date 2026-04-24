/**
 * public/scripts/dashboard/dashboard_widgets.js
 * @version 1.1.0 Phase C-2.5 (Patch: Tooltip Lazy Load)
 * @date 2026-04-24
 * @changelog
 * - Implemented client-side memory cache and lazy fetching for MTU and SI tooltip hover states.
 */

const DashboardWidgets = {
    /**
     * 渲染儀表板上方的統計數字卡片
     * @param {Object} stats - 統計資料物件
     */
    renderStats(stats = {}) {
        const updateText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        // 1. 基礎數據更新
        updateText('contacts-count', stats.contactsCount || 0);
        this._updateTrend('contacts-trend', stats.contactsCountMonth);

        updateText('opportunities-count', stats.opportunitiesCount || 0);
        this._updateTrend('opportunities-trend', stats.opportunitiesCountMonth);
        
        updateText('event-logs-count', stats.eventLogsCount || 0);
        this._updateTrend('event-logs-trend', stats.eventLogsCountMonth);

        updateText('won-count', stats.wonCount || 0);
        this._updateTrend('won-trend', stats.wonCountMonth);

        // 2. MTU 統計與浮動資訊卡片 (Tooltip)
        updateText('mtu-count', stats.mtuCount || 0);
        this._updateTrend('mtu-trend', stats.mtuCountMonth);
        
        // 若有 MTU 詳細資料，則渲染浮動視窗
        if (stats.mtuDetails) {
            this._setupLazyTooltip('mtu', 'mtu-count', stats.mtuDetails);
        }

        updateText('si-count', stats.siCount || 0);
        this._updateTrend('si-trend', stats.siCountMonth);
        
        if (stats.siDetails) {
            this._setupLazyTooltip('si', 'si-count', stats.siDetails);
        }
        
        // 確保樣式存在
        this._ensureStyles();
    },

    _updateTrend(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value > 0 ? `+ ${value} 本月` : '';
    },

    _companyActivityDetailsCache: { mtu: null, si: null },

    _setupLazyTooltip(type, elementId, details) {
        const countEl = document.getElementById(elementId);
        if (!countEl) return;

        // 找到卡片容器 (.stat-card)
        const card = countEl.closest('.stat-card');
        if (!card) return;

        // 清除舊的 Tooltip
        const oldTooltip = card.querySelector('.custom-tooltip');
        if (oldTooltip) oldTooltip.remove();

        const title = type === 'mtu' ? 'MTU 拜訪概況' : 'SI 拜訪概況';
        const totalTarget = details.totalMtu !== undefined ? details.totalMtu : details.totalSi;

        // 建立 Tooltip HTML
        const tooltip = document.createElement('div');
        tooltip.className = 'custom-tooltip';
        tooltip.innerHTML = `
            <div class="tooltip-header">${title}</div>
            <div class="tooltip-row">
                <span>總目標家數:</span> <strong>${totalTarget}</strong>
            </div>
            <div class="tooltip-row">
                <span>已互動:</span> <span class="text-success">${details.activeCount}</span>
            </div>
            <div class="tooltip-row">
                <span>未互動:</span> <span class="text-danger">${details.inactiveCount}</span>
            </div>
            <div class="tooltip-divider"></div>
            <div class="tooltip-subtitle">${details.inactiveCount > 0 ? '未互動名單 (載入中...)' : '<span class="text-success">🎉 全部皆已互動！</span>'}</div>
            <ul class="tooltip-list" id="lazy-list-${type}"></ul>
        `;

        // 將卡片設為 relative 以便定位
        card.style.position = 'relative';
        card.style.cursor = 'pointer'; 
        card.appendChild(tooltip);

        if (details.inactiveCount > 0) {
            let hasHovered = false;
            card.addEventListener('mouseenter', async () => {
                if (hasHovered) return;
                hasHovered = true;
                
                const listEl = tooltip.querySelector(`#lazy-list-${type}`);
                const subtitleEl = tooltip.querySelector('.tooltip-subtitle');
                
                if (this._companyActivityDetailsCache[type]) {
                    this._renderTooltipList(listEl, subtitleEl, this._companyActivityDetailsCache[type]);
                    return;
                }
                
                try {
                    const res = await authedFetch(`/api/dashboard/company-activity-details?type=${type}`);
                    if (res.success && res.data) {
                        this._companyActivityDetailsCache[type] = res.data;
                        this._renderTooltipList(listEl, subtitleEl, res.data);
                    } else {
                        throw new Error('Fetch failed');
                    }
                } catch (e) {
                    subtitleEl.textContent = '未互動名單 (載入失敗)';
                    listEl.innerHTML = '<li class="text-danger">名單載入失敗</li>';
                    hasHovered = false; // Allow retry on next hover
                }
            });
        }
    },

    _renderTooltipList(listEl, subtitleEl, data) {
        const maxDisplay = 5;
        const inactiveListHtml = data.inactiveNames.slice(0, maxDisplay)
            .map(name => `<li>❌ ${name}</li>`).join('');
        const remainingCount = data.inactiveNames.length - maxDisplay;
        const moreHtml = remainingCount > 0 ? `<li class="more">...還有 ${remainingCount} 家</li>` : '';
        
        subtitleEl.textContent = `未互動名單 (前 ${maxDisplay} 筆):`;
        listEl.innerHTML = inactiveListHtml + moreHtml;
    },

    /**
     * 渲染公告區塊
     * @param {Array} announcements - 公告列表
     */
    renderAnnouncements(announcements) {
        const container = document.querySelector('#announcement-widget .widget-content');
        const header = document.querySelector('#announcement-widget .widget-header');
        if (!container || !header) return;

        // 清除舊按鈕避免重複
        const oldBtn = header.querySelector('.action-btn');
        if(oldBtn) oldBtn.remove();

        const viewAllBtn = document.createElement('button');
        viewAllBtn.className = 'action-btn secondary';
        viewAllBtn.textContent = '查看更多公告';
        viewAllBtn.onclick = () => CRM_APP.navigateTo('announcements');
        header.appendChild(viewAllBtn);

        if (!announcements || announcements.length === 0) {
            container.innerHTML = `<div class="alert alert-info" style="text-align: center;">目前沒有公告</div>`;
            return;
        }

        let html = '<div class="announcement-list">';
        // 僅顯示最新的一則
        announcements.slice(0, 1).forEach(item => {
            const isPinnedIcon = item.isPinned ? '<span class="pinned-icon" title="置頂公告">📌</span>' : '';
            html += `
                <div class="announcement-item" data-announcement-id="${item.id}">
                    <div class="announcement-header">
                        <h4 class="announcement-title">${isPinnedIcon}${item.title}</h4>
                        <span class="announcement-creator">👤 ${item.creator}</span>
                    </div>
                    <p class="announcement-content">${item.content}</p>
                    <div class="announcement-footer">
                        <span class="announcement-time">發佈於 ${formatDateTime(item.lastUpdateTime)}</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;

        // 處理過長內容的展開收合
        const announcementItem = container.querySelector('.announcement-item');
        if (announcementItem) {
            const contentP = announcementItem.querySelector('.announcement-content');
            if (contentP.scrollHeight > contentP.clientHeight) {
                const footer = announcementItem.querySelector('.announcement-footer');
                const toggleBtn = document.createElement('button');
                toggleBtn.textContent = '展開';
                toggleBtn.className = 'action-btn small secondary announcement-toggle';
                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    contentP.classList.toggle('expanded');
                    toggleBtn.textContent = contentP.classList.contains('expanded') ? '收合' : '展開';
                };
                footer.prepend(toggleBtn);
            }
        }
        
        // 注入樣式
        this._ensureStyles();
    },

    /**
     * 渲染最新動態列表
     * @param {Array} feedData - 動態資料列表
     * @returns {string} HTML 字串 (僅回傳字串，由 Controller 注入 DOM)
     */
    renderActivityFeed(feedData) {
        if (!feedData || feedData.length === 0) return '<div class="alert alert-info">尚無最新動態</div>';
        
        const iconMap = { '系統事件': '⚙️', '會議討論': '📅', '事件報告': '📝', '電話聯繫': '📞', '郵件溝通': '📧', 'new_contact': '👤' };
        let html = '<ul class="activity-feed-list">';
        
        feedData.forEach(item => {
            html += `<li class="activity-feed-item">`;
            if (item.type === 'interaction') {
                const i = item.data;
                let contextLink = i.contextName || '系統活動';
                // 產生連結
                if (i.opportunityId) {
                    contextLink = `<a href="#" class="text-link" onclick="event.preventDefault(); CRM_APP.navigateTo('opportunity-details', { opportunityId: '${i.opportunityId}' })">${i.contextName}</a>`;
                } else if (i.companyId && i.contextName !== '系統活動' && i.contextName !== '未知公司' && i.contextName !== '未指定') {
                    const encodedCompanyName = encodeURIComponent(i.contextName);
                    contextLink = `<a href="#" class="text-link" onclick="event.preventDefault(); CRM_APP.navigateTo('company-details', { companyName: '${encodedCompanyName}' })">${i.contextName}</a>`;
                }
                
                // 處理連結內容的 markdown 格式
                let summaryHTML = i.contentSummary || '';
                const linkRegex = /\[(.*?)\]\(event_log_id=([a-zA-Z0-9]+)\)/g;
                summaryHTML = summaryHTML.replace(linkRegex, (fullMatch, text, eventId) => {
                    const safeEventId = eventId.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    return `<a href="#" class="text-link" onclick="event.preventDefault(); showEventLogReport('${safeEventId}')">${text}</a>`;
                });

                html += `<div class="feed-icon">${iconMap[i.eventType] || '🔔'}</div>
                         <div class="feed-content">
                            <div class="feed-text"><strong>${i.recorder}</strong> 在 <strong>${contextLink}</strong> ${i.eventTitle ? `建立了${i.eventTitle}` : `新增了一筆${i.eventType}`}</div>
                            <div class="feed-summary">${summaryHTML}</div>
                            <div class="feed-time">${formatDateTime(i.interactionTime)}</div>
                         </div>`;
            } else if (item.type === 'new_contact') {
                const c = item.data;
                const creator = c.userNickname ? `<strong>${c.userNickname}</strong> 新增了潛在客戶:` : `<strong>新增潛在客戶:</strong>`;
                html += `<div class="feed-icon">${iconMap['new_contact']}</div>
                         <div class="feed-content">
                            <div class="feed-text">${creator} ${c.name || '(無姓名)'}</div>
                            <div class="feed-summary">🏢 ${c.company || '(無公司資訊)'}</div>
                            <div class="feed-time">${formatDateTime(c.createdTime)}</div>
                         </div>`;
            }
            html += `</li>`;
        });
        html += '</ul>';
        return html;
    },

    _ensureStyles() {
        if (!document.getElementById('dashboard-widget-styles')) {
            const style = document.createElement('style');
            style.id = 'dashboard-widget-styles';
            style.innerHTML = `
                /* 公告樣式 */
                .announcement-item { padding: 1rem; border-radius: var(--rounded-lg); cursor: pointer; transition: background-color 0.2s ease; border: 1px solid var(--border-color); }
                .announcement-item:hover { background-color: var(--glass-bg); }
                .announcement-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; gap: 1rem; }
                .announcement-title { font-weight: 600; color: var(--text-primary); margin: 0; }
                .pinned-icon { margin-right: 0.5rem; }
                .announcement-creator { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); background: var(--glass-bg); padding: 2px 8px; border-radius: 1rem; flex-shrink: 0; }
                .announcement-content { font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; margin: 0; white-space: pre-wrap; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
                .announcement-content.expanded { -webkit-line-clamp: unset; max-height: none; }
                .announcement-footer { margin-top: 0.75rem; display:flex; justify-content: space-between; align-items: center; }
                .announcement-toggle { margin-right: auto; }
                .announcement-time { font-size: 0.8rem; color: var(--text-muted); }

                /* 浮動資訊卡片 Tooltip 樣式 */
                .custom-tooltip {
                    display: none;
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(255, 255, 255, 0.98);
                    backdrop-filter: blur(10px);
                    border: 1px solid var(--border-color);
                    box-shadow: 0 10px 25px rgba(0,0,0,0.15);
                    padding: 12px;
                    border-radius: 8px;
                    width: 220px;
                    z-index: 1000;
                    margin-top: 10px;
                    font-size: 0.85rem;
                    text-align: left;
                    color: var(--text-primary);
                }
                
                /* 三角形箭頭 */
                .custom-tooltip::before {
                    content: '';
                    position: absolute;
                    top: -6px;
                    left: 50%;
                    transform: translateX(-50%);
                    border-width: 0 6px 6px 6px;
                    border-style: solid;
                    border-color: transparent transparent var(--border-color) transparent;
                }

                .stat-card:hover .custom-tooltip {
                    display: block;
                    animation: tooltipFadeIn 0.2s ease-out;
                }

                @keyframes tooltipFadeIn {
                    from { opacity: 0; transform: translate(-50%, 5px); }
                    to { opacity: 1; transform: translate(-50%, 0); }
                }

                .tooltip-header {
                    font-weight: 700;
                    margin-bottom: 8px;
                    text-align: center;
                    color: var(--primary-color);
                    border-bottom: 1px solid var(--border-color);
                    padding-bottom: 4px;
                }

                .tooltip-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 4px;
                }

                .tooltip-divider {
                    height: 1px;
                    background: var(--border-color);
                    margin: 8px 0;
                }

                .tooltip-subtitle {
                    font-weight: 600;
                    margin-bottom: 4px;
                    font-size: 0.8rem;
                    color: var(--text-secondary);
                }

                .tooltip-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    max-height: 150px;
                    overflow-y: auto;
                }

                .tooltip-list li {
                    padding: 2px 0;
                    color: var(--text-secondary);
                    font-size: 0.8rem;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .tooltip-list li.more {
                    color: var(--text-muted);
                    font-style: italic;
                    text-align: center;
                    margin-top: 4px;
                }

                .text-success { color: #10b981; font-weight: 600; }
                .text-danger { color: #ef4444; font-weight: 600; }
            `;
            document.head.appendChild(style);
        }
    }
};

window.DashboardWidgets = DashboardWidgets;
// public/scripts/internal-ops/internal-ops-dev-projects.js
/**
 * @version 1.0.10
 * @date 2026-04-22
 * @changelog
 * - [1.0.10] UI Revert Patch: Reverted Dev Projects list display to the simpler baseline reference style. Removed scoped CSS wrappers, fixed table layouts, and strict text truncations, while fully preserving all current logic (working-days calculation, config mapping, opportunity linking, and action toggles).
 * - [1.0.9] UI Polish Patch: Moved record count to the right, fixed schedule column truncation.
 * - [1.0.8] UI Stabilization Patch: Applied table-layout fixed, defined key column widths, enforced ellipsis.
 * - [1.0.7] UI Stabilization Patch: Isolated CSS scope, enforced nowrap table layout.
 * - [1.0.6] Typography Polish: Stabilized list readability by scaling down schedule dates.
 * - [1.0.5] Debug Patch: Injected safe tracing logs into getConfigColor.
 * - [1.0.4] Polish Patch: Improved Dev Projects list readability.
 * - [1.0.3] Logic Patch: Replaced naive theoretical progress calculation with a working-days-based calculation.
 * - [1.0.2] Phase A: Added hyperlinked Opportunity routing.
 * - [1.0.1] UI Patch: Renamed labels, merged schedule columns, refined strict fixed-width progress rendering, replaced row actions with header toggle.
 * - [1.0.0] Extracted from internal-ops.js Phase 4.8
 * @description 負責「開發案件追蹤」區塊的資料渲染與局部互動邏輯
 */

window.toggleDevTableActions = function() {
    window.__isDevActionMode = !window.__isDevActionMode;
    const container = document.getElementById('internal-ops-dev-projects-content');
    if (container && window.__internalOpsDevProjectsData) {
        container.innerHTML = window.renderDevProjects(window.__internalOpsDevProjectsData);
    }
};

window.renderDevProjects = function(data) {
    window.__internalOpsDevProjectsData = data; 

    // [Logic Preserved] Config mapping and trace logs
    function getConfigColor(type, text, fallbackHex) {
        console.group('[DevProjects][getConfigColor]');
        console.log('type:', type);
        console.log('text (status):', text);

        if (!text || text === '-') {
            console.warn('Text is empty or "-", using FALLBACK color:', fallbackHex);
            console.groupEnd();
            return window.buildColorSet(fallbackHex);
        }
        
        const list = window.__systemConfig[type] || [];
        
        console.log('config list:', list);
        list.forEach(i => {
            console.log('checking item:', {
                note: i.note,
                value: i.value,
                style: i.style
            });
        });

        const item = list.find(i => {
            const match = (i.note === text || i.value === text);
            if (match) {
                console.log('MATCH FOUND:', i);
            }
            return match;
        });

        if (!item) {
            console.warn('NO MATCH FOUND for status:', text);
        }

        if (item && item.style) {
            console.log('Using CONFIG color:', item.style);
        } else {
            console.warn('Using FALLBACK color:', fallbackHex);
        }
        console.groupEnd();

        if (item && item.style) {
            return window.buildColorSet(item.style);
        }
        return window.buildColorSet(fallbackHex);
    }

    function getBadgeHtml(text, colorSet) {
        if (!text || text === '-') return '-';
        return `<span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:0.75rem; font-weight:600; background:${colorSet.bgLight}; color:${colorSet.text}; border: 1px solid ${colorSet.border}; white-space: nowrap;">${text}</span>`;
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

    // [Logic Preserved] Working days calculation
    function calculateWorkingDays(startDate, endDate) {
        let count = 0;
        let cur = new Date(startDate);
        cur.setHours(0, 0, 0, 0);
        let end = new Date(endDate);
        end.setHours(0, 0, 0, 0);

        while (cur <= end) {
            const day = cur.getDay();
            if (day !== 0 && day !== 6) {
                count++;
            }
            cur.setDate(cur.getDate() + 1);
        }
        return count;
    }

    function calculateTheoreticalProgress(startStr, endStr) {
        if (!startStr || !endStr) return null;

        const start = new Date(startStr);
        const end = new Date(endStr);
        const now = new Date();

        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        now.setHours(0, 0, 0, 0);

        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return null;

        if (now < start) return 0;
        if (now > end) return 100;

        const totalWorkingDays = calculateWorkingDays(start, end);
        if (totalWorkingDays === 0) {
            return (now >= start) ? 100 : 0;
        }

        const elapsedWorkingDays = calculateWorkingDays(start, now);
        const prog = Math.round((elapsedWorkingDays / totalWorkingDays) * 100);
        
        return Math.min(Math.max(prog, 0), 100);
    }

    // [Display Reverted] Progress block simplified, removed wrapper classes, kept 0.8rem typography
    function getCombinedProgressHtml(actualProgressText, startDate, estDate) {
        if (!actualProgressText) actualProgressText = '0%';
        const aVal = parseInt(actualProgressText.replace('%', ''), 10) || 0;
        const clampedAVal = Math.min(Math.max(aVal, 0), 100);
        let aHex;
        if (aVal < 30) aHex = '#616161';
        else if (aVal > 70) aHex = '#2e7d32';
        else aHex = '#1976d2';
        const aColor = window.buildColorSet(aHex);

        let tProg = 0;
        let clampedTVal = 0;
        let cueHtml = '';
        let tProgText = '-';
        
        if (startDate && estDate) {
            const start = new Date(startDate).setHours(0,0,0,0);
            const end = new Date(estDate).setHours(23,59,59,999);
            const now = new Date().setHours(0,0,0,0);

            if (!isNaN(start) && !isNaN(end) && start < end) {
                if (now >= end) tProg = 100;
                else if (now > start) tProg = Math.round(((now - start) / (end - start)) * 100);
                
                clampedTVal = Math.min(Math.max(tProg, 0), 100);
                tProgText = `${tProg}%`;
                
                const diff = aVal - tProg;
                if (diff <= -10) cueHtml = `<span style="color:#c62828; font-size:0.75rem; font-weight: bold; white-space: nowrap;">落後</span>`;
                else if (diff >= 10) cueHtml = `<span style="color:#2e7d32; font-size:0.75rem; font-weight: bold; white-space: nowrap;">超前</span>`;
            }
        }

        return `
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 200px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.8rem; color: #6b7280; width: 28px; flex-shrink: 0; text-align: right; white-space: nowrap;">實際</span>
                    <div style="width: 70px; height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; flex-shrink: 0;">
                        <div style="width: ${clampedAVal}%; height: 100%; background: ${aColor.text};"></div>
                    </div>
                    <span style="color:${aColor.text}; font-size: 0.8rem; font-weight: 600; width: 36px; text-align: right; flex-shrink: 0;">${actualProgressText}</span>
                    <span style="width: 30px; flex-shrink: 0;"></span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.8rem; color: #6b7280; width: 28px; flex-shrink: 0; text-align: right; white-space: nowrap;">理論</span>
                    <div style="width: 70px; height: 6px; background: ${tProgText === '-' ? 'transparent' : '#f3f4f6'}; border: ${tProgText === '-' ? 'none' : '1px dashed #d1d5db'}; border-radius: 3px; overflow: hidden; flex-shrink: 0;">
                        <div style="width: ${clampedTVal}%; height: 100%; background: #9ca3af;"></div>
                    </div>
                    <span style="color: ${tProgText === '-' ? '#9ca3af' : '#6b7280'}; font-size: 0.8rem; font-weight: 600; width: 36px; text-align: right; flex-shrink: 0;">${tProgText}</span>
                    <span style="width: 30px; flex-shrink: 0; text-align: left;">${cueHtml}</span>
                </div>
            </div>
        `;
    }

    const rows = data.map((item, index) => {
        // [Display Reverted] Schedule block simplified, removed wrapper classes
        const scheduleHtml = `
            <div style="display: flex; flex-direction: column; gap: 4px; min-width: 110px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; gap: 8px;">
                    <span style="color: #9ca3af; white-space: nowrap;">開始</span>
                    <span style="color: #6b7280; white-space: nowrap;">${item.startDate || '-'}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; gap: 8px;">
                    <span style="color: #9ca3af; white-space: nowrap;">預計完成</span>
                    <span style="color: #6b7280; white-space: nowrap;">${item.estCompletionDate || '-'}</span>
                </div>
            </div>
        `;

        // [Logic Preserved] Action toggle
        const actionHtml = window.__isDevActionMode ? `
            <div style="display: flex; gap: 12px; justify-content: center;">
                <span style="cursor:pointer;" onclick="window.openDevProjectModal('${item.devId}')" title="編輯">✏️</span>
                <span style="cursor:pointer;" onclick="window.deleteDevProject('${item.devId}')" title="刪除">🗑️</span>
            </div>
        ` : '';

        // [Display Reverted] Opp linking simplified, removed strict ellipsis styling, preserved routing logic
        let oppHtml = '-';
        if (item.assigneeCode && item.projectName) {
            oppHtml = `<a href="#" style="color: #1976d2; text-decoration: none; font-weight: 600;" onclick="event.preventDefault(); window.CRM_APP.navigateTo('opportunity-details', {opportunityId: '${item.assigneeCode}'})">${item.projectName}</a>`;
        } else if (item.projectName) {
            oppHtml = `<strong>${item.projectName}</strong>`;
        }

        // [Display Reverted] Collaborators simplified, allowed natural break word
        let collabsHtml = '-';
        if (item.collaborators) {
            const names = item.collaborators.split('｜').map(s => s.trim()).filter(Boolean);
            if (names.length > 0) {
                collabsHtml = `<div style="font-size: 0.85rem; max-width: 150px; overflow-wrap: break-word; line-height: 1.4;">${names.join('、')}</div>`;
            }
        }

        // [Display Reverted] Notes simplified, returned to pre-wrap and auto scroll
        let notesHtml = '-';
        if (item.notes && item.notes.trim() !== '') {
            notesHtml = `<div style="font-size: 0.8rem; color: #6b7280; max-width: 180px; max-height: 60px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; padding-right: 4px;">${item.notes}</div>`;
        }

        return `
        <tr>
            <td>${index + 1}</td>
            <td>${item.productName || '-'}</td>
            <td>${oppHtml}</td>
            <td>${item.featureName || '-'}</td>
            <td style="white-space: nowrap;">${item.assigneeName || '-'}</td>
            <td>${collabsHtml}</td>
            <td>${getStageBadge(item.devStage || '-')}</td>
            <td>${getStatusBadge(item.status || '-')}</td>
            <td>${scheduleHtml}</td>
            <td>${getCombinedProgressHtml(item.progress, item.startDate, item.estCompletionDate)}</td>
            <td>${notesHtml}</td>
            <td style="vertical-align: middle; text-align: center;">${actionHtml}</td>
        </tr>
    `}).join('');

    // [Display Reverted] Removed scoped wrappers, injected styles, fixed layouts. Reverted count display.
    return `
        <div style="font-size: 0.9rem; color: #6b7280; margin-bottom: 12px; font-weight: 500; padding: 0 4px;">共 ${data.length} 筆</div>
        <table class="internal-ops-table">
            <thead>
                <tr>
                    <th style="width: 50px;">#</th>
                    <th>開發案件名稱</th>
                    <th>關聯機會</th>
                    <th>關聯功能</th>
                    <th>負責人</th>
                    <th>協作成員</th>
                    <th>開發階段</th>
                    <th>狀態</th>
                    <th>開發時程</th>
                    <th>進度</th>
                    <th>備註</th>
                    <th onclick="window.toggleDevTableActions()" style="cursor: pointer; user-select: none; width: 70px; text-align: center; color: #1976d2; white-space: nowrap;" title="點擊切換編輯模式">操作 ${window.__isDevActionMode ? '−' : '+'}</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
};
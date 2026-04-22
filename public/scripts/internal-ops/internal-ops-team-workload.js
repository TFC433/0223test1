// public/scripts/internal-ops/internal-ops-team-workload.js
/**
 * @version 1.0.0 (Extracted from internal-ops.js Phase 4.8)
 * @date 2026-04-22
 * @description 負責「團隊成員負荷」區塊的資料渲染與局部互動邏輯
 */

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

window.renderTeamWorkload = function(data) {
    window.__internalOpsTeamWorkloadData = data; 
    
    if (!data || data.length === 0) return '';

    function getConfigColor(type, text, fallbackHex) {
        if (!text || text === '-') return window.buildColorSet(fallbackHex);
        const list = window.__systemConfig[type] || [];
        const item = list.find(i => i.note === text || i.value === text);
        if (item && item.style) {
            return window.buildColorSet(item.style);
        }
        return window.buildColorSet(fallbackHex);
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

    const groups = {};

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

    const memberNames = Object.keys(groups).sort();
    
    let html = '<div class="team-workload-groups" style="display: flex; flex-direction: column; gap: 24px;">';
    const toggleIcon = `<svg class="toggle-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

    memberNames.forEach(member => {
        const groupData = groups[member];
        const tasks = groupData.tasks;
        
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
                <td><strong>${item.productName || item.projectName || '-'}</strong></td>
                <td>${getStageBadge(item.devStage || '-')}</td>
                <td>${getRoleBadge(item._role)}</td>
                <td>${getStatusBadge(item.status || '-')}</td>
            </tr>
        `).join('');

        const totalTasks = groupData.main + groupData.collab;
        const maxCapacity = 6;
        const workloadPercent = Math.min(Math.max((totalTasks / maxCapacity) * 100, 0), 100).toFixed(0);
        
        let barHex;
        if (totalTasks >= 6) {
            barHex = '#c62828'; 
        } else if (totalTasks >= 3) {
            barHex = '#f9a825'; 
        } else {
            barHex = '#2e7d32'; 
        }

        const workloadBarHtml = `
            <div style="display: flex; align-items: center; gap: 8px; margin-left: 8px; font-size: 0.85rem; font-weight: normal;">
                <div style="width: 80px; height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; display: flex;">
                    <div style="width: ${workloadPercent}%; height: 100%; background: ${barHex}; transition: width 0.3s ease;"></div>
                </div>
                <span style="color: ${barHex}; font-weight: 600;">${workloadPercent}%</span>
                <span style="color: #6b7280; margin-left: 4px; font-size: 0.8rem;">主 ${groupData.main} / 協 ${groupData.collab} / 共 ${totalTasks}</span>
            </div>
        `;

        html += `
            <div class="member-workload-card">
                <div class="member-workload-header" onclick="window.toggleWorkload(this)">
                    <h3 style="display: flex; align-items: center; margin: 0; font-size: 1.05rem; color: #111827; font-weight: 600; flex-wrap: wrap;">
                        ${toggleIcon}
                        <span>${member}</span>
                        ${workloadBarHtml}
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
};
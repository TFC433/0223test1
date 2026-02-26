/**
 * Project: TFC CRM
 * File: public/scripts/opportunities/opportunity-details.js
 * Version: 8.0.10
 * Date: 2026-02-26
 * Changelog: remove risky id transfer; keep minimal wiring restoration
 */

window.currentDetailOpportunityId = null;
window.currentOpportunityData = null;

/**
 * 載入並渲染機會詳細頁面的主函式
 * @param {string} opportunityId - 機會ID
 */
async function loadOpportunityDetailPage(opportunityId) {
    window.currentDetailOpportunityId = opportunityId;

    const container = document.getElementById('page-opportunity-details');
    if (!container) return;

    container.innerHTML = `
        <div class="loading show" style="padding-top: 50px;">
            <div class="spinner"></div>
            <p>正在載入機會詳細資料...</p>
        </div>
    `;

    try {
        const opportunityDetailPageTemplate = await fetch('/views/opportunity-detail.html').then(res => res.text());
        const result = await authedFetch(`/api/opportunities/${opportunityId}/details`);
        if (!result.success) throw new Error(result.error);

        const {
            opportunityInfo,
            interactions,
            eventLogs,
            linkedContacts,
            potentialContacts,
            parentOpportunity,
            childOpportunities
        } = result.data;

        window.currentOpportunityData = opportunityInfo;

        // 1. 注入主模板
        container.innerHTML = opportunityDetailPageTemplate;
        document.getElementById('page-title').textContent = '機會案件管理 - 機會詳細';
        document.getElementById('page-subtitle').textContent = '機會詳細資料與關聯活動';

        // 2. 注入資訊卡（接回 OpportunityInfoCard.render 以恢復 inline edit wrappers）
        const infoCardContainer = document.getElementById('opportunity-info-card-container');
        if (infoCardContainer) {
            if (typeof OpportunityInfoCard !== 'undefined' && typeof OpportunityInfoCard.render === 'function') {
                OpportunityInfoCard.render(opportunityInfo);
            } else if (typeof OpportunityInfoView !== 'undefined' && typeof OpportunityInfoView.render === 'function') {
                // Fallback：若 InfoCard module 未載入，至少維持可讀的 view
                infoCardContainer.innerHTML = `
                    <div class="dashboard-widget">
                        <div class="widget-content">
                            ${OpportunityInfoView.render(opportunityInfo)}
                        </div>
                    </div>
                `;
            }
        }

        // 3. 初始化資訊卡事件（render 後）
        if (typeof OpportunityInfoCardEvents !== 'undefined' && typeof OpportunityInfoCardEvents.init === 'function') {
            OpportunityInfoCardEvents.init(opportunityInfo);
        }

        // 4. 其他模組初始化（順序不變）
        const Stepper = window.OpportunityStepper || (typeof OpportunityStepper !== 'undefined' ? OpportunityStepper : null);
        if (Stepper && typeof Stepper.init === 'function') {
            Stepper.init(opportunityInfo);
        }

        const Events = window.OpportunityEvents || (typeof OpportunityEvents !== 'undefined' ? OpportunityEvents : null);
        if (Events && typeof Events.init === 'function') {
            Events.init(eventLogs || [], {
                opportunityId: opportunityInfo.opportunityId,
                opportunityName: opportunityInfo.opportunityName,
                linkedContacts: linkedContacts || []
            });
        }

        const interactionContainer = document.getElementById('tab-content-interactions');
        if (interactionContainer) {
            const Interactions = window.OpportunityInteractions || (typeof OpportunityInteractions !== 'undefined' ? OpportunityInteractions : null);
            if (Interactions && typeof Interactions.init === 'function') {
                Interactions.init(
                    interactionContainer,
                    { opportunityId: opportunityInfo.opportunityId },
                    interactions || []
                );
            }
        }

        const Contacts = window.OpportunityContacts || (typeof OpportunityContacts !== 'undefined' ? OpportunityContacts : null);
        if (Contacts && typeof Contacts.init === 'function') {
            Contacts.init(opportunityInfo, linkedContacts || []);
        }

        const AssocOpps = window.OpportunityAssociatedOpps || (typeof OpportunityAssociatedOpps !== 'undefined' ? OpportunityAssociatedOpps : null);
        if (AssocOpps && typeof AssocOpps.render === 'function') {
            AssocOpps.render({
                opportunityInfo,
                parentOpportunity,
                childOpportunities
            });
        }

        if (window.PotentialContactsManager) {
            PotentialContactsManager.render({
                containerSelector: '#opp-potential-contacts-container',
                potentialContacts: potentialContacts || [],
                comparisonList: linkedContacts || [],
                comparisonKey: 'name',
                context: 'opportunity',
                opportunityId: opportunityInfo.opportunityId
            });
        }

        const APP = window.CRM_APP || (typeof CRM_APP !== 'undefined' ? CRM_APP : null);
        if (APP && typeof APP.updateAllDropdowns === 'function') {
            APP.updateAllDropdowns();
        }

    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('[OpportunityDetails] 載入失敗:', error);
            container.innerHTML = `
                <div class="alert alert-error">
                    載入機會詳細資料失敗: ${error.message}
                </div>
            `;
        }
    }
}

// 向主應用程式註冊此模組管理的頁面載入函式
window.loadOpportunityDetailPage = loadOpportunityDetailPage;
if (window.CRM_APP) {
    if (!window.CRM_APP.pageModules) window.CRM_APP.pageModules = {};
    window.CRM_APP.pageModules['opportunity-details'] = loadOpportunityDetailPage;
}
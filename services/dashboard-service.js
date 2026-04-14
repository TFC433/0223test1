// ============================================================================
// File: services/dashboard-service.js
// ============================================================================
/**
 * services/dashboard-service.js
 * 儀表板業務邏輯層 (Dashboard Aggregator)
 * @version v1.1.1 Dashboard RAW Contact KPI Patch
 * @date 2026-04-14
 * @changelog
 * - [PATCH] Fixed "潛在客戶數量" KPI to use RAW contacts (Google Sheets) via contactRawReader instead of CORE (SQL), maintaining minimal diff and performance.
 * - [PERF] Parallelized dashboard data fetch groups (Batch1, Batch2, Batch3, Weekly) to reduce first-load latency.
 * - [PERF] Eliminated full contacts table hydration from dashboard flow.
 * - [PERF] Introduced O(1) latestInteractionMap lookup to replace nested interaction scans.
 * - [PERF] Introduced targeted MTU/SI event activity projection to avoid full event_logs hydration.
 * - [CLEANUP] Removed temporary performance instrumentation used during forensics.
 * - Removed DashboardService DEBUG console logs
 */

class DashboardService {
    /**
     * 建構子：接收所有必要的資料讀取器與服務
     * @param {Object} config - 系統設定
     * @param {ContactService} contactService - [Phase 7 Fix]
     * @param {EventLogSqlReader} eventLogSqlReader - [Phase 8.3d] Strict SQL Reader
     * @param {SystemReader} systemReader
     * @param {WeeklyBusinessService} weeklyBusinessService
     * @param {CalendarService} calendarService
     * @param {ContactSqlReader} contactSqlReader - [Phase 8.7] SQL Reader
     * @param {InteractionSqlReader} interactionSqlReader - [Phase 8.7] SQL Reader
     * @param {CompanySqlReader} companySqlReader - [Phase 8.7] SQL Reader
     * @param {OpportunitySqlReader} opportunitySqlReader - [Phase 8.7] SQL Reader
     * @param {SystemService} systemService - [Phase 8.8] Service Layer
     */
    constructor(
        config,
        contactService,
        eventLogSqlReader, // Renamed to enforce SQL usage
        systemReader,
        weeklyBusinessService,
        calendarService,
        contactSqlReader,
        interactionSqlReader,
        companySqlReader,
        opportunitySqlReader,
        systemService
    ) {
        // 嚴格檢查依賴 (移除舊有 Sheet Readers 的檢查)
        if (!contactService || !config || !eventLogSqlReader) {
            throw new Error('[DashboardService] 初始化失敗：缺少必要的 Reader/Service 或 Config');
        }

        this.config = config;
        this.contactService = contactService;
        
        // [Phase 8.3d] Explicitly store as SQL reader to avoid confusion
        this.eventLogSqlReader = eventLogSqlReader;
        
        this.systemReader = systemReader;
        this.weeklyBusinessService = weeklyBusinessService;
        this.calendarService = calendarService;

        // [Phase 8.7] SQL Readers
        this.contactSqlReader = contactSqlReader;
        this.interactionSqlReader = interactionSqlReader;
        this.companySqlReader = companySqlReader;
        this.opportunitySqlReader = opportunitySqlReader;
        
        // [Phase 8.8] Service Layer
        this.systemService = systemService;
    }

    /**
     * 【內部輔助】取得週次 ID 
     */
    _getWeekId(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }

    /**
     * 取得主儀表板所需的所有整合資料
     * 採用分批請求 (Batching) 與 Promise.all 並行處理以優化效能
     */
    async getDashboardData() {
        console.log('📊 [DashboardService] 執行主儀表板資料整合 (SQL-Only Mode, Parallelized)...');

        const today = new Date();
        const thisWeekId = this._getWeekId(today);
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        // --- Parallel Fetch Architecture ---
        // Shared Promise: Company data is needed by both Batch 2 (reference data) and Batch 3 (MTU/SI stats).
        // Hoisted to avoid duplicate SQL reads across concurrent batches.
        const companyPromise = this.companySqlReader ? this.companySqlReader.getCompanies() : Promise.resolve([]);

        // =================================================================
        // Parallel Data Fetch Groups
        // =================================================================

        // --- Batch 1: Core Business Data ---
        // Responsibilities: Fetch primary entities (Opportunities, Interactions) required for active kanban and activity feeds.
        const batch1Promise = (async () => {
            const oppPromise = this.opportunitySqlReader.getOpportunities();
            const intPromise = this.interactionSqlReader.getInteractions();
            return await Promise.all([oppPromise, intPromise]);
        })();

        // --- Batch 2: Secondary / Reference Data ---
        // Responsibilities: Fetch calendar events, system configuration, companies, and a lightweight contact feed.
        const batch2Promise = (async () => {
            const calendarPromise = this.calendarService ? this.calendarService.getThisWeekEvents() : Promise.resolve({ todayEvents: [], todayCount: 0, weekCount: 0 });
            const systemPromise = this.systemService ? this.systemService.getSystemConfig() : Promise.resolve({});
            
            // Performance Fix: Fetch strictly limited top 5 contacts for feed to bypass full table load, saving memory and DB time.
            const recentContactsPromise = typeof this.contactSqlReader.getRecentContactsFeed === 'function' 
                ? this.contactSqlReader.getRecentContactsFeed(5)
                : Promise.resolve([]);

            return await Promise.all([
                calendarPromise,
                systemPromise,
                companyPromise,
                recentContactsPromise
            ]);
        })();

        // --- Batch 3: SQL Aggregation Stats & RAW Contacts ---
        // Responsibilities: Offload heavy COUNT/GROUP BY operations to the SQL layer (Opportunities, EventLogs). Fetch RAW Contacts directly.
        const batch3Promise = (async () => {
            // [PATCH] Fetch RAW Contacts for the "潛在客戶數量" KPI safely
            const rawContactsPromise = (this.contactService && this.contactService.contactRawReader)
                ? this.contactService.contactRawReader.getContacts()
                : Promise.resolve([]);
                
            const opportunityStatsPromise = this.opportunitySqlReader.getOpportunityStats(startOfMonth);
            const eventStatsPromise = this.eventLogSqlReader.getEventLogStats(startOfMonth);

            // Await companies specifically to build MTU/SI target IDs
            const companies = await companyPromise;
            
            const normalize = (name) => (name || '').trim().toLowerCase();
            const isStrictMTU = (type) => normalize(type) === 'mtu';
            const isSI = (type) => /SI|系統整合|System Integrator/i.test(type || '');

            const targetCompanyIds = companies
                .filter(c => isStrictMTU(c.companyType) || isSI(c.companyType))
                .map(c => c.companyId)
                .filter(Boolean);

            // Performance Fix: Targeted MTU/SI event activity projection to avoid full event_logs hydration.
            const eventActivityPromise = typeof this.companySqlReader.getTargetCompanyEventActivities === 'function' && targetCompanyIds.length > 0
                ? this.companySqlReader.getTargetCompanyEventActivities(targetCompanyIds)
                : Promise.resolve([]);

            const [rawContacts, opportunityStats, eventStats, eventActivities] = await Promise.all([
                rawContactsPromise,
                opportunityStatsPromise,
                eventStatsPromise,
                eventActivityPromise
            ]);

            // [PATCH] Calculate contactStats using RAW Potential Contacts
            let rawTotal = 0;
            let rawMonth = 0;
            rawContacts.forEach(c => {
                if (c.name || c.company) {
                    rawTotal++;
                    const ts = new Date(c.createdTime).getTime();
                    if (!isNaN(ts) && ts >= startOfMonth.getTime()) {
                        rawMonth++;
                    }
                }
            });
            const contactStats = { total: rawTotal, month: rawMonth };

            return [
                contactStats,
                opportunityStats,
                eventStats,
                eventActivities
            ];
        })();

        // --- Weekly Details: Weekly Business Data Integration ---
        const weeklyPromise = (async () => {
            let thisWeeksEntries = [];
            let thisWeekDetails = { title: '載入中...', days: [] };

            if (this.weeklyBusinessService) {
                try {
                    const fullDetails = await this.weeklyBusinessService.getWeeklyDetails(thisWeekId);
                    if (fullDetails) {
                        thisWeekDetails = fullDetails;
                        thisWeeksEntries = fullDetails.entries || [];
                    }
                } catch (error) {
                    console.error(`[DashboardService] 週間業務載入失敗 (${thisWeekId}):`, error.message);
                    thisWeekDetails = {
                        title: `Week ${thisWeekId} (載入失敗)`,
                        days: [],
                        month: today.getMonth() + 1,
                        weekOfMonth: '?',
                        shortDateRange: ''
                    };
                }
            }
            return { thisWeeksEntries, thisWeekDetails };
        })();

        // =================================================================
        // Resolve All Parallel Groups
        // =================================================================
        const [batch1Result, batch2Result, batch3Result, weeklyResult] = await Promise.all([
            batch1Promise,
            batch2Promise,
            batch3Promise,
            weeklyPromise
        ]);

        // =================================================================
        // 資料處理與統計邏輯 (Post-Fetch Aggregation)
        // =================================================================
        const [opportunitiesRaw, interactions] = batch1Result;
        const [calendarData, systemConfig, companies, recentContactsRaw] = batch2Result;
        const [contactStats, opportunityStats, eventStats, eventActivities] = batch3Result;
        const { thisWeeksEntries, thisWeekDetails } = weeklyResult;

        const normalize = (name) => (name || '').trim().toLowerCase();
        const isStrictMTU = (type) => normalize(type) === 'mtu';
        const isSI = (type) => /SI|系統整合|System Integrator/i.test(type || '');

        // 1. 計算機會最後活動時間
        // Performance Fix: O(1) Map lookup replaces nested interaction scans (O(N*M))
        const latestInteractionMap = new Map();
        interactions.forEach(interaction => {
            const existingTimestamp = latestInteractionMap.get(interaction.opportunityId) || 0;
            const currentTimestamp = new Date(interaction.interactionTime || interaction.createdTime).getTime();
            if (currentTimestamp > existingTimestamp) {
                latestInteractionMap.set(interaction.opportunityId, currentTimestamp);
            }
        });

        opportunitiesRaw.forEach(opp => {
            const selfUpdateTime = new Date(opp.lastUpdateTime || opp.createdTime).getTime();
            const lastInteractionTime = latestInteractionMap.get(opp.opportunityId) || 0;
            opp.effectiveLastActivity = Math.max(selfUpdateTime, lastInteractionTime);
        });

        const opportunities = opportunitiesRaw.sort((a, b) => b.effectiveLastActivity - a.effectiveLastActivity);

        // MTU/SI 統計邏輯
        const companyNameMap = new Map();
        companies.forEach(c => {
            if (c.companyName) {
                companyNameMap.set(normalize(c.companyName), c.companyId);
            }
        });
        
        const staticMtuList = companies.filter(c => isStrictMTU(c.companyType));

        const activeCompanyIds = new Set();
        const earliestActivityMap = new Map();

        const recordActivity = (cId, timeStr) => {
            if (!cId) return;
            activeCompanyIds.add(cId);
            
            const time = new Date(timeStr).getTime();
            if (isNaN(time)) return;
            
            const currentEarliest = earliestActivityMap.get(cId);
            if (!currentEarliest || time < currentEarliest) {
                earliestActivityMap.set(cId, time);
            }
        };

        // We already have interactions and opportunities in full, process them normally
        interactions.forEach(i => i.companyId && recordActivity(i.companyId, i.interactionTime || i.createdTime));
        opportunities.forEach(opp => {
            const cId = companyNameMap.get(normalize(opp.customerCompany));
            if (cId) recordActivity(cId, opp.createdTime);
        });
        
        // Iterate over heavily targeted, minimal DB projection (using raw snake_case keys)
        eventActivities.forEach(e => e.company_id && recordActivity(e.company_id, e.created_time));

        let mtuCount = 0;
        let mtuNewMonth = 0;
        let siCount = 0;
        let siNewMonth = 0;

        const activeMtuNames = [];
        const inactiveMtuNames = [];

        staticMtuList.forEach(comp => {
            const cId = comp.companyId;
            const name = comp.companyName;

            if (activeCompanyIds.has(cId)) {
                mtuCount++;
                activeMtuNames.push(name);
                
                const firstTime = earliestActivityMap.get(cId);
                if (firstTime >= startOfMonth.getTime()) {
                    mtuNewMonth++;
                }
            } else {
                inactiveMtuNames.push(name);
            }
        });

        companies.forEach(comp => {
             if (activeCompanyIds.has(comp.companyId) && isSI(comp.companyType)) {
                 siCount++;
                 const firstTime = earliestActivityMap.get(comp.companyId);
                 if (firstTime >= startOfMonth.getTime()) siNewMonth++;
             }
        });

        const wonOpportunities = opportunities.filter(o => 
            o.currentStage === '受注' || o.currentStage === '已成交' || o.currentStatus === '已完成'
        );
        const wonCount = wonOpportunities.length;
        const wonCountMonth = wonOpportunities.filter(o => {
            const dateStr = o.expectedCloseDate || o.lastUpdateTime;
            if(!dateStr) return false;
            return new Date(dateStr) >= startOfMonth;
        }).length;

        // 傳遞已預先計算的 latestInteractionMap，消滅 O(N*M) 巢狀迴圈
        const followUps = this._getFollowUpOpportunities(opportunities, latestInteractionMap);

        const stats = {
            contactsCount: contactStats.total,
            opportunitiesCount: opportunityStats.total,
            eventLogsCount: eventStats.total,
            
            wonCount: wonCount,
            wonCountMonth: wonCountMonth,
            
            mtuCount: mtuCount,
            mtuCountMonth: mtuNewMonth,
            siCount: siCount,
            siCountMonth: siNewMonth,

            mtuDetails: {
                totalMtu: staticMtuList.length,
                activeCount: mtuCount,
                inactiveCount: inactiveMtuNames.length,
                activeNames: activeMtuNames,     
                inactiveNames: inactiveMtuNames
            },

            todayEventsCount: calendarData.todayCount || 0,
            weekEventsCount: calendarData.weekCount || 0,
            followUpCount: followUps.length,
            
            contactsCountMonth: contactStats.month,
            opportunitiesCountMonth: opportunityStats.month,
            eventLogsCountMonth: eventStats.month,
        };

        const kanbanData = this._prepareKanbanData(opportunities, systemConfig);
        
        // 嚴格重現 Recent Activity 合併邏輯，但不拉取 Contacts 全表
        const recentActivity = this._prepareRecentActivity(interactions, recentContactsRaw, opportunities, companies, 5);
        
        const thisWeekInfoForDashboard = {
            weekId: thisWeekId,
            title: thisWeekDetails.title || `Week ${thisWeekId}`,
            days: thisWeekDetails.days || [] 
        };

        return {
            stats,
            kanbanData,
            followUpList: followUps.slice(0, 5),
            todaysAgenda: calendarData.todayEvents || [],
            recentActivity,
            weeklyBusiness: thisWeeksEntries,
            thisWeekInfo: thisWeekInfoForDashboard
        };
    }

    // --- 各個子頁面的 Dashboard Data Getters ---

    async getCompaniesDashboardData() {
        const companies = await this.companySqlReader.getCompanies();

        return {
            chartData: {
                trend: this._prepareTrendData(companies),
                type: this._prepareCompanyTypeData(companies),
                stage: this._prepareCustomerStageData(companies),
                rating: this._prepareEngagementRatingData(companies),
            }
        };
    }

    async getEventsDashboardData() {
        // [Phase 8.3d] STRICT SQL READ (This isolated page still needs full payload)
        const eventLogs = await this.eventLogSqlReader.getEventLogs();
        
        // Use Promise.all for others
        const [opportunities, companies] = await Promise.all([
            this.opportunitySqlReader.getOpportunities(),
            this.companySqlReader.getCompanies(),
        ]);

        const opportunityMap = new Map(opportunities.map(opp => [opp.opportunityId, opp]));
        const companyMap = new Map(companies.map(comp => [comp.companyId, comp]));

        const eventList = eventLogs.map(log => {
            const relatedOpp = opportunityMap.get(log.opportunityId);
            const relatedComp = companyMap.get(log.companyId);

            return {
                ...log,
                opportunityName: relatedOpp ? relatedOpp.opportunityName : (relatedComp ? relatedComp.companyName : null),
                companyName: relatedComp ? relatedComp.companyName : null,
                opportunityType: relatedOpp ? relatedOpp.opportunityType : null
            };
        });

        eventList.sort((a, b) => {
            const timeA = new Date(a.lastModifiedTime || a.createdTime).getTime();
            const timeB = new Date(b.lastModifiedTime || b.createdTime).getTime();
            if (isNaN(timeA)) return 1;
            if (isNaN(timeB)) return -1;
            return timeB - timeA;
        });

        return {
            eventList,
            chartData: {
                trend: this._prepareTrendData(eventLogs),
                eventType: this._prepareEventTypeData(eventLogs),
                size: this._prepareSizeData(eventLogs),
            }
        };
    }

    async getOpportunitiesDashboardData() {
        const [opportunities, systemConfig] = await Promise.all([
            this.opportunitySqlReader.getOpportunities(),
            this.systemService.getSystemConfig(),
        ]);

        return {
            chartData: {
                trend: this._prepareTrendData(opportunities),
                source: this._prepareCategoricalData(opportunities, 'opportunitySource', '機會來源', systemConfig),
                type: this._prepareCategoricalData(opportunities, 'opportunityType', '機會種類', systemConfig),
                stage: this._prepareOpportunityStageData(opportunities, systemConfig),
                probability: this._prepareCategoricalData(opportunities, 'orderProbability', '下單機率', systemConfig),
                specification: this._prepareSpecificationData(opportunities, '可能下單規格', systemConfig),
                channel: this._prepareCategoricalData(opportunities, 'salesChannel', '可能銷售管道', systemConfig),
                scale: this._prepareCategoricalData(opportunities, 'deviceScale', '設備規模', systemConfig),
            }
        };
    }

    async getContactsDashboardData() {
        const contacts = await this.contactSqlReader.getContacts();
        return {
            chartData: {
                trend: this._prepareTrendData(contacts),
            }
        };
    }

    // --- 內部資料處理函式 (Data Processing Helpers) ---

    // [Performance Fix] Receives O(1) Map instead of raw interactions array.
    _getFollowUpOpportunities(opportunities, latestInteractionMap) {
        const daysThreshold = (this.config.FOLLOW_UP && this.config.FOLLOW_UP.DAYS_THRESHOLD) || 7;
        const activeStages = (this.config.FOLLOW_UP && this.config.FOLLOW_UP.ACTIVE_STAGES) || ['01_初步接觸', '02_需求確認', '03_提案報價', '04_談判修正'];
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - daysThreshold);
        const thresholdTime = sevenDaysAgo.getTime();

        return opportunities.filter(opp => {
            if (opp.currentStatus !== '進行中' || !activeStages.includes(opp.currentStage)) {
                return false;
            }
            
            const lastInteractionTime = latestInteractionMap.get(opp.opportunityId);
            
            if (!lastInteractionTime) {
                const createdDate = new Date(opp.createdTime);
                return createdDate.getTime() < thresholdTime;
            }
            
            return lastInteractionTime < thresholdTime;
        });
    }

    _prepareKanbanData(opportunities, systemConfig) {
        const stages = systemConfig['機會階段'] || [];
        const stageGroups = {};
        
        stages.forEach(stage => { 
            stageGroups[stage.value] = { name: stage.note || stage.value, opportunities: [], count: 0 }; 
        });
        
        opportunities.forEach(opp => {
            if (opp.currentStatus === '進行中') {
                const stageKey = opp.currentStage;
                if (stageGroups[stageKey]) {
                    stageGroups[stageKey].opportunities.push(opp);
                    stageGroups[stageKey].count++;
                }
            }
        });
        return stageGroups;
    }

    // [Performance Fix] Accepts limited contact array, maintains exact original sorting semantics
    _prepareRecentActivity(interactions, contactsLimitArray, opportunities, companies, limit) {
        const contactFeed = contactsLimitArray.map(item => {
            const ts = new Date(item.createdTime);
            return { type: 'new_contact', timestamp: isNaN(ts.getTime()) ? 0 : ts.getTime(), data: item };
        });
        
        // Preserve exact semantic fidelity: Interaction Time OR Created Time
        const interactionFeed = interactions.map(item => {
            const ts = new Date(item.interactionTime || item.createdTime);
            return { type: 'interaction', timestamp: isNaN(ts.getTime()) ? 0 : ts.getTime(), data: item };
        });

        // Safe absolute Top N sort because interactionFeed is exhaustive and contactFeed represents the absolute Top 5 contacts
        const combinedFeed = [...interactionFeed, ...contactFeed]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);

        const opportunityMap = new Map(opportunities.map(opp => [opp.opportunityId, opp.opportunityName]));
        const companyMap = new Map(companies.map(comp => [comp.companyId, comp.companyName]));

        return combinedFeed.map(item => {
            if (item.type === 'interaction') {
                let contextName = opportunityMap.get(item.data.opportunityId);
                if (!contextName && item.data.companyId) {
                    contextName = companyMap.get(item.data.companyId);
                }

                return {
                    ...item,
                    data: {
                        ...item.data,
                        contextName: contextName || '系統活動'
                    }
                };
            }
            return item;
        });
    }

    _prepareTrendData(data, days = 30) {
        const trend = {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            trend[date.toISOString().split('T')[0]] = 0;
        }

        data.forEach(item => {
            if (item.createdTime) {
                try {
                    const itemDate = new Date(item.createdTime);
                    const dateString = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate()).toISOString().split('T')[0];
                    if (trend.hasOwnProperty(dateString)) trend[dateString]++;
                } catch(e) { /* ignore */ }
            }
        });
        return Object.entries(trend).sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB));
    }

    _prepareEventTypeData(eventLogs) {
        const counts = eventLogs.reduce((acc, log) => {
            const key = log.eventType || 'general';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(counts).map(([name, y]) => ({ name, y }));
    }

    _prepareSizeData(eventLogs) {
        const counts = eventLogs.reduce((acc, log) => {
            const key = log.companySize || log.iot_deviceScale || '未填寫';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
    }

    _prepareCategoricalData(data, fieldKey, configKey, systemConfig) {
        const nameMap = new Map((systemConfig[configKey] || []).map(item => [item.value, item.note]));
        const counts = data.reduce((acc, item) => {
            const value = item[fieldKey];
            const key = nameMap.get(value) || value || '未分類';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(counts).map(([name, y]) => ({ name, y }));
    }

    _prepareSpecificationData(opportunities, configKey, systemConfig) {
        const nameMap = new Map((systemConfig[configKey] || []).map(item => [item.value, item.note]));
        const counts = {};

        opportunities.forEach(item => {
            const value = item.potentialSpecification;
            if (!value) return;

            let keys = [];
            
            try {
                const parsedJson = JSON.parse(value);
                if (parsedJson && typeof parsedJson === 'object') {
                    keys = Object.keys(parsedJson).filter(k => parsedJson[k] > 0);
                } else {
                    if (typeof value === 'string') {
                        keys = value.split(',').map(s => s.trim()).filter(Boolean);
                    }
                }
            } catch (e) {
                if (typeof value === 'string') {
                    keys = value.split(',').map(s => s.trim()).filter(Boolean);
                }
            }
            
            keys.forEach(key => {
                const displayName = nameMap.get(key) || key;
                counts[displayName] = (counts[displayName] || 0) + 1;
            });
        });

        return Object.entries(counts).map(([name, y]) => ({ name, y }));
    }

    _prepareOpportunityStageData(opportunities, systemConfig) {
        const stageMapping = new Map((systemConfig['機會階段'] || []).map(item => [item.value, item.note]));
        const counts = opportunities.reduce((acc, opp) => {
            if (opp.currentStatus === '進行中') {
                const key = stageMapping.get(opp.currentStage) || opp.currentStage || '未分類';
                acc[key] = (acc[key] || 0) + 1;
            }
            return acc;
        }, {});
        return Object.entries(counts);
    }

    _prepareCompanyTypeData(companies) {
        const counts = companies.reduce((acc, company) => {
            const key = company.companyType || '未分類';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(counts).map(([name, y]) => ({ name, y }));
    }

    _prepareCustomerStageData(companies) {
        const counts = companies.reduce((acc, company) => {
            const key = company.customerStage || '未分類';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(counts).map(([name, y]) => ({ name, y }));
    }

    _prepareEngagementRatingData(companies) {
        const counts = companies.reduce((acc, company) => {
            const key = company.engagementRating || '未評級';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        return Object.entries(counts).map(([name, y]) => ({ name, y }));
    }
}

module.exports = DashboardService;
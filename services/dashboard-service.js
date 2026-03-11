/**
 * services/dashboard-service.js
 * 儀表板業務邏輯層 (Dashboard Aggregator)
 * @version 8.8.2 (Phase 8.3 Task: Strict SQL Readers Only + Debug Logs)
 * @date 2026-03-11
 * @description 負責整合各個模組的數據，計算統計指標、圖表數據與 KPI。
 * * [Forensics Fix / Phase 8.3 Task]
 * - Enforced eventLogSqlReader injection to strictly bypass Google Sheets for events.
 * - Removed ambiguous eventLogReader usage.
 * - Migrated all remaining Dashboard legacy reads to pure SQL readers.
 * - [Phase 8.8] Replaced deprecated systemReader calls with systemService.
 * - [Phase 8.3 Task] COMPLETELY REMOVED companyReader, opportunityReader, interactionReader dependencies.
 * - [Phase 8.3 Task] Added temporary debug logs for getDashboardData payload forensics.
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
     * 採用分批請求 (Batching) 以優化效能
     */
    async getDashboardData() {
        console.log('📊 [DashboardService] 執行主儀表板資料整合 (SQL-Only Mode)...');

        const today = new Date();
        const thisWeekId = this._getWeekId(today);

        // --- Batch 1: 核心業務資料 ---
        console.log('   ↳ 正在載入核心資料 (Batch 1)...');
        const [
            opportunitiesRaw,
            contacts,
            interactions
        ] = await Promise.all([
            this.opportunitySqlReader.getOpportunities(),
            this.contactSqlReader.getContacts(),
            this.interactionSqlReader.getInteractions()
        ]);

        // --- Batch 2: 次要/參考資料 ---
        console.log('   ↳ 正在載入參考資料 (Batch 2)...');
        
        const calendarPromise = this.calendarService ? this.calendarService.getThisWeekEvents() : Promise.resolve({ todayEvents: [], todayCount: 0, weekCount: 0 });
        const companyPromise = this.companySqlReader ? this.companySqlReader.getCompanies() : Promise.resolve([]);
        
        // [Phase 8.3d] STRICT SQL READ
        const eventLogPromise = this.eventLogSqlReader.getEventLogs();
        
        const systemPromise = this.systemService ? this.systemService.getSystemConfig() : Promise.resolve({});

        const [
            calendarData,
            eventLogs,
            systemConfig,
            companies
        ] = await Promise.all([
            calendarPromise,
            eventLogPromise,
            systemPromise,
            companyPromise
        ]);

        // --- 週間業務資料整合 ---
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

        // =================================================================
        // 資料處理與統計邏輯
        // =================================================================

        // 1. 計算機會最後活動時間
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

        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        const contactsCountMonth = contacts.filter(c => new Date(c.createdTime) >= startOfMonth).length;
        const opportunitiesCountMonth = opportunities.filter(o => new Date(o.createdTime) >= startOfMonth).length;
        const eventLogsCountMonth = eventLogs.filter(e => new Date(e.createdTime) >= startOfMonth).length;

        // MTU/SI 統計邏輯
        const normalize = (name) => (name || '').trim().toLowerCase();
        
        const companyNameMap = new Map();
        companies.forEach(c => {
            if (c.companyName) {
                companyNameMap.set(normalize(c.companyName), c.companyId);
            }
        });

        const isStrictMTU = (type) => normalize(type) === 'mtu';
        const isSI = (type) => /SI|系統整合|System Integrator/i.test(type || '');
        
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

        interactions.forEach(i => i.companyId && recordActivity(i.companyId, i.interactionTime || i.createdTime));
        eventLogs.forEach(e => e.companyId && recordActivity(e.companyId, e.createdTime));
        opportunities.forEach(opp => {
            const cId = companyNameMap.get(normalize(opp.customerCompany));
            if (cId) recordActivity(cId, opp.createdTime);
        });

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

        const followUps = this._getFollowUpOpportunities(opportunities, interactions);

        const stats = {
            contactsCount: contacts.length,
            opportunitiesCount: opportunities.length,
            eventLogsCount: eventLogs.length,
            
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
            
            contactsCountMonth,
            opportunitiesCountMonth,
            eventLogsCountMonth,
        };

        const kanbanData = this._prepareKanbanData(opportunities, systemConfig);
        const recentActivity = this._prepareRecentActivity(interactions, contacts, opportunities, companies, 5);
        
        const thisWeekInfoForDashboard = {
            weekId: thisWeekId,
            title: thisWeekDetails.title || `Week ${thisWeekId}`,
            days: thisWeekDetails.days || [] 
        };

        // --- TEMPORARY DEBUG LOGS ---
        console.log(`[DashboardService][DEBUG] opportunitiesRaw=${opportunitiesRaw.length}, contacts=${contacts.length}, interactions=${interactions.length}, eventLogs=${eventLogs.length}, companies=${companies.length}`);
        console.log(`[DashboardService][DEBUG] final stats=`, JSON.stringify(stats));
        console.log(`[DashboardService][DEBUG] kanban keys=`, Object.keys(kanbanData).length);
        console.log(`[DashboardService][DEBUG] followUpList length=${followUps.slice(0, 5).length}`);
        console.log(`[DashboardService][DEBUG] todaysAgenda length=${(calendarData.todayEvents || []).length}`);
        console.log(`[DashboardService][DEBUG] recentActivity length=${recentActivity.length}`);
        console.log(`[DashboardService][DEBUG] weeklyBusiness length=${thisWeeksEntries.length}`);
        console.log(`[DashboardService][DEBUG] thisWeekInfo=`, JSON.stringify(thisWeekInfoForDashboard));
        // --- END DEBUG LOGS ---

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
        // [Phase 8.3d] STRICT SQL READ
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

    _getFollowUpOpportunities(opportunities, interactions) {
        const daysThreshold = (this.config.FOLLOW_UP && this.config.FOLLOW_UP.DAYS_THRESHOLD) || 7;
        const activeStages = (this.config.FOLLOW_UP && this.config.FOLLOW_UP.ACTIVE_STAGES) || ['01_初步接觸', '02_需求確認', '03_提案報價', '04_談判修正'];
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - daysThreshold);

        return opportunities.filter(opp => {
            if (opp.currentStatus !== '進行中' || !activeStages.includes(opp.currentStage)) {
                return false;
            }
            const oppInteractions = interactions.filter(i => i.opportunityId === opp.opportunityId);
            if (oppInteractions.length === 0) {
                const createdDate = new Date(opp.createdTime);
                return createdDate < sevenDaysAgo;
            }
            
            const sortedInteractions = oppInteractions.sort((a,b) => 
                new Date(b.interactionTime || b.createdTime) - new Date(a.interactionTime || a.createdTime)
            );
            const lastInteractionDate = new Date(sortedInteractions[0].interactionTime || sortedInteractions[0].createdTime);
            
            return lastInteractionDate < sevenDaysAgo;
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

    _prepareRecentActivity(interactions, contacts, opportunities, companies, limit) {
        const contactFeed = contacts.map(item => {
            const ts = new Date(item.createdTime);
            return { type: 'new_contact', timestamp: isNaN(ts.getTime()) ? 0 : ts.getTime(), data: item };
        });
        const interactionFeed = interactions.map(item => {
            const ts = new Date(item.interactionTime || item.createdTime);
            return { type: 'interaction', timestamp: isNaN(ts.getTime()) ? 0 : ts.getTime(), data: item };
        });

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
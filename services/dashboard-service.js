// ============================================================================
// File: services/dashboard-service.js
// ============================================================================
/**
 * services/dashboard-service.js
 * 儀表板業務邏輯層 (Dashboard Aggregator)
 * @version 2.6.0 Phase C-2.1-E MTU KPI Fix
 * @date 2026-04-23
 * @changelog
 * - [PHASE C-2.1-E] MTU KPI switched to has_activity-based visited logic
 * - [PHASE C-2.1-E] first_activity no longer used as the primary visited-MTU condition
 * - [PHASE C-2.1-D] MTU / SI activity aggregation moved to one SQL-first flow
 * - [PHASE C-2.1-D] Node-side dashboard aggregation further reduced
 * - [PHASE C-2.1-C] MTU / SI activity aggregation moved to SQL
 * - [PHASE C-2.1-C] Node-side dashboard aggregation reduced
 * - [PHASE C-2.1-B] moved MTU / SI activity aggregation toward SQL
 * - [PHASE C-2.1] Moved KPI aggregation (Won Counts) to direct SQL COUNT.
 * - [PHASE C-2.1] Reduced full-table hydration for opportunities and companies using SQL projection.
 * - [PHASE C-2.1] Pushed down Kanban/Follow-up filters to SQL to eliminate in-memory array bloat.
 */

const { supabase } = require('../config/supabase');

class DashboardService {
    constructor(
        config,
        contactService,
        eventLogSqlReader, 
        systemReader,
        weeklyBusinessService,
        calendarService,
        contactSqlReader,
        interactionSqlReader,
        companySqlReader,
        opportunitySqlReader,
        systemService
    ) {
        if (!contactService || !config || !eventLogSqlReader) {
            throw new Error('[DashboardService] 初始化失敗：缺少必要的 Reader/Service 或 Config');
        }

        this.config = config;
        this.contactService = contactService;
        this.eventLogSqlReader = eventLogSqlReader;
        this.systemReader = systemReader;
        this.weeklyBusinessService = weeklyBusinessService;
        this.calendarService = calendarService;
        this.contactSqlReader = contactSqlReader;
        this.interactionSqlReader = interactionSqlReader;
        this.companySqlReader = companySqlReader;
        this.opportunitySqlReader = opportunitySqlReader;
        this.systemService = systemService;
    }

    _getWeekId(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }

    async getDashboardData() {
        console.log('📊 [DashboardService] 執行主儀表板資料整合 (Phase C-2.1 SQL-First Mode)...');

        const today = new Date();
        const thisWeekId = this._getWeekId(today);
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        const companyPromise = this.companySqlReader ? this.companySqlReader.getCompanies() : Promise.resolve([]);

        // =================================================================
        // Parallel Data Fetch Groups
        // =================================================================

        // --- Batch 1: Core Business Data ---
        const batch1Promise = (async () => {
            // [PHASE C-2.1] Pushdown filters to SQL: Fetch only active deals for UI
            const activeOppsPromise = this.opportunitySqlReader.searchOpportunitiesTable
                ? this.opportunitySqlReader.searchOpportunitiesTable({ filters: { status: '進行中' }, limit: 1000, offset: 0 }).then(res => res.data || [])
                : this.opportunitySqlReader.getOpportunities().then(all => all.filter(o => o.currentStatus === '進行中'));

            // [PHASE C-2.1] Lightweight cross-domain projection for stats and names
            const lightweightOppsPromise = supabase.from('opportunities')
                .select('opportunity_id, opportunity_name, customer_company, created_time');
            
            // [PHASE 9-A] Targeted SQL reads instead of full table hydration
            const intActivityPromise = typeof this.interactionSqlReader.getInteractionActivities === 'function'
                ? this.interactionSqlReader.getInteractionActivities()
                : this.interactionSqlReader.getInteractions(); // Fallback
                
            const recentIntPromise = typeof this.interactionSqlReader.getRecentInteractionsFeed === 'function'
                ? this.interactionSqlReader.getRecentInteractionsFeed(5)
                : Promise.resolve([]);

            return await Promise.all([activeOppsPromise, lightweightOppsPromise, intActivityPromise, recentIntPromise]);
        })();

        // --- Batch 2: Secondary / Reference Data ---
        const batch2Promise = (async () => {
            const calendarPromise = this.calendarService ? this.calendarService.getThisWeekEvents() : Promise.resolve({ todayEvents: [], todayCount: 0, weekCount: 0 });
            const systemPromise = this.systemService ? this.systemService.getSystemConfig() : Promise.resolve({});
            
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
        const batch3Promise = (async () => {
            const rawContactsPromise = (this.contactService && this.contactService.contactRawReader)
                ? this.contactService.contactRawReader.getContacts()
                : Promise.resolve([]);
                
            const opportunityStatsPromise = this.opportunitySqlReader.getOpportunityStats(startOfMonth);
            const eventStatsPromise = this.eventLogSqlReader.getEventLogStats(startOfMonth);

            const companies = await companyPromise;
            
            const normalize = (name) => (name || '').trim().toLowerCase();
            const isStrictMTU = (type) => normalize(type) === 'mtu';
            const isSI = (type) => /SI|系統整合|System Integrator/i.test(type || '');

            const targetCompanyIds = companies
                .filter(c => isStrictMTU(c.companyType) || isSI(c.companyType))
                .map(c => c.companyId)
                .filter(Boolean);

            const eventActivityPromise = typeof this.companySqlReader.getTargetCompanyEventActivities === 'function' && targetCompanyIds.length > 0
                ? this.companySqlReader.getTargetCompanyEventActivities(targetCompanyIds)
                : Promise.resolve([]);

            // [PHASE C-2.1] SQL KPI Aggregation (Replacing in-memory fetch and filter)
            const wonCountPromise = supabase.from('opportunities')
                .select('opportunity_id', { count: 'exact', head: true })
                .or('current_stage.in.(受注,已成交),current_status.eq.已完成');
                
            const startOfMonthIso = startOfMonth.toISOString();
            const wonMonthPromise = supabase.from('opportunities')
                .select('opportunity_id', { count: 'exact', head: true })
                .or('current_stage.in.(受注,已成交),current_status.eq.已完成')
                .gte('updated_time', startOfMonthIso);

            const [rawContacts, opportunityStats, eventStats, eventActivities, wonCountRes, wonMonthRes] = await Promise.all([
                rawContactsPromise,
                opportunityStatsPromise,
                eventStatsPromise,
                eventActivityPromise,
                wonCountPromise,
                wonMonthPromise
            ]);

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
                eventActivities,
                wonCountRes,
                wonMonthRes
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
        
        const [activeOpportunitiesRaw, lightweightOppsRes, interactionActivities, recentInteractions] = batch1Result;
        
        const [calendarData, systemConfig, companies, recentContactsRaw] = batch2Result;
        const [contactStats, opportunityStats, eventStats, eventActivities, wonCountRes, wonMonthRes] = batch3Result;
        const { thisWeeksEntries, thisWeekDetails } = weeklyResult;

        const normalize = (name) => (name || '').trim().toLowerCase();
        const isStrictMTU = (type) => normalize(type) === 'mtu';
        const isSI = (type) => /SI|系統整合|System Integrator/i.test(type || '');

        const activeOpportunities = activeOpportunitiesRaw.sort((a, b) => b.effectiveLastActivity - a.effectiveLastActivity);
        const lightweightOpps = lightweightOppsRes.data || [];

        // =================================================================
        // PHASE C-2.1-D/E SQL-FIRST AGGREGATION: MTU / SI Activity
        // =================================================================
        let mtuCount = 0;
        let mtuNewMonth = 0;
        let siCount = 0;
        let siNewMonth = 0;
        const activeMtuNames = [];
        const inactiveMtuNames = [];
        let totalMtu = 0;

        try {
            // 1. ONE SQL-First flow returning aggregated per-company activity.
            // Assumes DB provides v_company_activity_summary with UNION ALL & MIN() logic.
            const { data: targetCompanies, error } = await supabase
                .from('v_company_activity_summary')
                .select('company_id, company_name, company_type, first_activity, has_activity')
                .or('company_type.ilike.%mtu%,company_type.ilike.%si%,company_type.ilike.%系統整合%,company_type.ilike.%system integrator%');

            if (error) {
                console.error('[DashboardService] MTU/SI SQL View Error:', error);
            }

            const safeTargets = targetCompanies || [];

            // 2. Node.js only formats the final stats from the aggregated company rows
            safeTargets.forEach(comp => {
                const name = comp.company_name;
                const isMtu = isStrictMTU(comp.company_type);
                const isSi = isSI(comp.company_type);
                
                // Visited logic is now driven by has_activity
                const isActive = comp.has_activity === true;

                // first_activity is provided directly by SQL aggregation for month tracking
                const firstTime = comp.first_activity ? new Date(comp.first_activity).getTime() : Infinity;
                const isNewThisMonth = isActive && firstTime !== Infinity && !isNaN(firstTime) && (firstTime >= startOfMonth.getTime());

                if (isMtu) {
                    totalMtu++;
                    if (isActive) {
                        mtuCount++;
                        activeMtuNames.push(name);
                        if (isNewThisMonth) mtuNewMonth++;
                    } else {
                        inactiveMtuNames.push(name);
                    }
                }

                if (isSi && isActive) {
                    siCount++;
                    if (isNewThisMonth) siNewMonth++;
                }
            });
        } catch (error) {
            console.error('[DashboardService] SQL-First MTU/SI aggregation failed:', error);
        }

        // [PHASE C-2.1] SQL-based KPI aggregation replaces JS filtering
        const wonCount = wonCountRes ? (wonCountRes.count || 0) : 0;
        const wonCountMonth = wonMonthRes ? (wonMonthRes.count || 0) : 0;

        // Passed directly to rely on SQL-computed metric
        const followUps = this._getFollowUpOpportunities(activeOpportunities);

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
                totalMtu: totalMtu,
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

        const kanbanData = this._prepareKanbanData(activeOpportunities, systemConfig);
        
        // Relies on surgical recent SQL fetch
        const recentActivity = this._prepareRecentActivity(recentInteractions, recentContactsRaw, lightweightOpps, companies, 5);
        
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

    async getCompaniesDashboardData() {
        // [PHASE C-2.1] SQL-First: Fetch only required columns for chart aggregation
        const { data } = await supabase.from('companies').select('created_time, company_type, customer_stage, interaction_rating');
        const companies = (data || []).map(row => ({
            createdTime: row.created_time,
            companyType: row.company_type,
            customerStage: row.customer_stage,
            engagementRating: row.interaction_rating
        }));

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
        const eventLogs = await this.eventLogSqlReader.getEventLogs();
        
        // [PHASE C-2.1] SQL-First: Avoid full table hydration for cross-domain naming
        const [oppsRes, compsRes] = await Promise.all([
            supabase.from('opportunities').select('opportunity_id, opportunity_name, opportunity_type'),
            supabase.from('companies').select('company_id, company_name')
        ]);

        const opportunityMap = new Map((oppsRes.data || []).map(opp => [opp.opportunity_id, { opportunityName: opp.opportunity_name, opportunityType: opp.opportunity_type }]));
        const companyMap = new Map((compsRes.data || []).map(comp => [comp.company_id, { companyName: comp.company_name }]));

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
        // [PHASE C-2.1] SQL-First: Projection to avoid full JSON body hydration
        const [opportunitiesRes, systemConfig] = await Promise.all([
            supabase.from('opportunities').select('source, opportunity_type, current_stage, win_probability, product_details, sales_channel, equipment_scale, created_time'),
            this.systemService.getSystemConfig(),
        ]);
        
        const opportunities = (opportunitiesRes.data || []).map(row => ({
            opportunitySource: row.source,
            opportunityType: row.opportunity_type,
            currentStage: row.current_stage,
            orderProbability: row.win_probability,
            potentialSpecification: row.product_details,
            salesChannel: row.sales_channel,
            deviceScale: row.equipment_scale,
            createdTime: row.created_time
        }));

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

    // --- 內部資料處理函式 ---

    // [Phase 9-A] Signature simplified: completely relies on the reader's native SQL computed value.
    _getFollowUpOpportunities(opportunities) {
        const daysThreshold = (this.config.FOLLOW_UP && this.config.FOLLOW_UP.DAYS_THRESHOLD) || 7;
        const activeStages = (this.config.FOLLOW_UP && this.config.FOLLOW_UP.ACTIVE_STAGES) || ['01_初步接觸', '02_需求確認', '03_提案報價', '04_談判修正'];
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - daysThreshold);
        const thresholdTime = sevenDaysAgo.getTime();

        return opportunities.filter(opp => {
            if (opp.currentStatus !== '進行中' || !activeStages.includes(opp.currentStage)) {
                return false;
            }
            
            if (!opp.effectiveLastActivity) {
                const createdDate = new Date(opp.createdTime);
                return createdDate.getTime() < thresholdTime;
            }
            
            return opp.effectiveLastActivity < thresholdTime;
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

    _prepareRecentActivity(recentInteractions, contactsLimitArray, opportunities, companies, limit) {
        const contactFeed = contactsLimitArray.map(item => {
            const ts = new Date(item.createdTime);
            return { type: 'new_contact', timestamp: isNaN(ts.getTime()) ? 0 : ts.getTime(), data: item };
        });
        
        const interactionFeed = recentInteractions.map(item => {
            const ts = new Date(item.interactionTime || item.createdTime);
            return { type: 'interaction', timestamp: isNaN(ts.getTime()) ? 0 : ts.getTime(), data: item };
        });

        const combinedFeed = [...interactionFeed, ...contactFeed]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);

        // Account for both camelCase and snake_case based on caller hydration
        const opportunityMap = new Map(opportunities.map(opp => [opp.opportunityId || opp.opportunity_id, opp.opportunityName || opp.opportunity_name]));
        const companyMap = new Map(companies.map(comp => [comp.companyId || comp.company_id, comp.companyName || comp.company_name]));

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
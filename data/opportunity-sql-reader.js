/**
 * data/opportunity-sql-reader.js
 * [Strict Digital Forensics Mode]
 * - Type: SQL Reader (Read-Only)
 * - Target: PostgreSQL (Supabase)
 * - Table: opportunities
 * - Version: 2.0.1 (Phase 9-B.1)
 * - Date: 2026-04-15
 * - Changelog: 
 * - [PHASE 9-B.1] Added nullsFirst: false to .order() calls to ensure NULL values sort to the bottom, restoring legacy JS UX.
 * - [PHASE 9-B] DB-First effectiveLastActivity integration. Attempts to use 'v_opportunities_summary' view for true SQL pagination and sorting, with a seamless JS fallback.
 * * ============================================================================
 * REQUIRED SQL MIGRATION FOR DB-FIRST FAST-PATH:
 * * CREATE OR REPLACE VIEW v_opportunities_summary AS
 * SELECT 
 * o.*,
 * GREATEST(
 * o.updated_time,
 * o.created_time,
 * (SELECT MAX(COALESCE(i.interaction_time, i.created_time)) 
 * FROM interactions i 
 * WHERE i.opportunity_id = o.opportunity_id)
 * ) as effective_last_activity
 * FROM opportunities o;
 * ============================================================================
 */

const { supabase } = require('../config/supabase');

class OpportunitySqlReader {

    constructor() {
        this.tableName = 'opportunities';
        this.viewName = 'v_opportunities_summary'; // Phase 9-B DB-First Target
    }

    async getOpportunityStats(startOfMonth) {
        if (!startOfMonth) throw new Error('OpportunitySqlReader: startOfMonth is required');

        try {
            const startIso = startOfMonth.toISOString();

            const [totalRes, monthRes] = await Promise.all([
                supabase.from(this.tableName).select('*', { count: 'exact', head: true }),
                supabase.from(this.tableName).select('*', { count: 'exact', head: true }).gte('created_time', startIso)
            ]);

            if (totalRes.error) throw new Error(`[OpportunitySqlReader] DB Error (total): ${totalRes.error.message}`);
            if (monthRes.error) throw new Error(`[OpportunitySqlReader] DB Error (month): ${monthRes.error.message}`);

            return {
                total: totalRes.count || 0,
                month: monthRes.count || 0
            };
        } catch (error) {
            console.error('[OpportunitySqlReader] getOpportunityStats Error:', error);
            throw error;
        }
    }

    async getOpportunityById(opportunityId) {
        if (!opportunityId) throw new Error('OpportunitySqlReader: opportunityId is required');

        try {
            // [Phase 9-B] Try DB-First View
            const viewRes = await supabase.from(this.viewName).select('*').eq('opportunity_id', opportunityId).single();
            if (!viewRes.error && viewRes.data) {
                return this._mapRowToDto(viewRes.data);
            }

            // Fallback
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('opportunity_id', opportunityId)
                .single();

            if (error) {
                if (error.code === 'PGRST116') return null;
                throw new Error(`[OpportunitySqlReader] DB Error: ${error.message}`);
            }

            if (!data) return null;
            return this._mapRowToDto(data);

        } catch (error) {
            console.error('[OpportunitySqlReader] getOpportunityById Error:', error);
            throw error;
        }
    }

    async getOpportunitiesByParentId(parentId) {
        if (!parentId) throw new Error('OpportunitySqlReader: parentId is required');

        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('parent_opportunity_id', parentId);

            if (error) throw new Error(`[OpportunitySqlReader] DB Error: ${error.message}`);
            return data.map(row => this._mapRowToDto(row));

        } catch (error) {
            console.error('[OpportunitySqlReader] getOpportunitiesByParentId Error:', error);
            throw error;
        }
    }

    async getOpportunitiesByCompanyName(companyName) {
        if (!companyName) throw new Error('OpportunitySqlReader: companyName is required');

        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .ilike('customer_company', `%${companyName}%`);

            if (error) throw new Error(`[OpportunitySqlReader] DB Error: ${error.message}`);
            return data.map(row => this._mapRowToDto(row));

        } catch (error) {
            console.error('[OpportunitySqlReader] getOpportunitiesByCompanyName Error:', error);
            throw error;
        }
    }

    async getOpportunities() {
        try {
            // --- [Phase 9-B] ATTEMPT DB-FIRST VIEW PATH ---
            const viewRes = await supabase.from(this.viewName).select('*');
            if (!viewRes.error && viewRes.data) {
                return viewRes.data.map(row => this._mapRowToDto(row));
            }

            // --- LEGACY COMPATIBILITY FALLBACK ---
            const oppsPromise = supabase.from(this.tableName).select('*');
            const intsPromise = supabase.from('interactions').select('opportunity_id, interaction_time, created_time');

            const [oppsRes, intsRes] = await Promise.all([oppsPromise, intsPromise]);

            if (oppsRes.error) throw new Error(`[OpportunitySqlReader] DB Error: ${oppsRes.error.message}`);

            const latestIntMap = new Map();
            let interactionsFailed = false;

            if (intsRes.error) {
                console.warn('[OpportunitySqlReader] Degrade Mode Active: Interactions subquery failed.', intsRes.error.message);
                interactionsFailed = true;
            } else if (intsRes.data) {
                intsRes.data.forEach(int => {
                    const id = int.opportunity_id;
                    const time = new Date(int.interaction_time || int.created_time).getTime();
                    if (time && (!latestIntMap.has(id) || time > latestIntMap.get(id))) {
                        latestIntMap.set(id, time);
                    }
                });
            }

            return oppsRes.data.map(row => {
                const dto = this._mapRowToDto(row);
                if (!interactionsFailed) {
                    const lastInt = latestIntMap.get(dto.opportunityId) || 0;
                    if (lastInt > dto.effectiveLastActivity) {
                        dto.effectiveLastActivity = lastInt;
                    }
                }
                return dto;
            });

        } catch (error) {
            console.error('[OpportunitySqlReader] getOpportunities Error:', error);
            throw error;
        }
    }

    async searchOpportunitiesTable({ q, filters = {}, sortField, sortDirection, limit, offset }) {
        try {
            // =================================================================
            // STAGE 1: TRUE DB-FIRST PATH (Using SQL View)
            // Unlocks DB-level pagination, sorting, and time filtering for effectiveLastActivity
            // =================================================================
            try {
                let dbQuery = supabase.from(this.viewName).select('*', { count: 'exact' });
                
                // Native Filters
                if (filters.type && filters.type !== 'all') dbQuery = dbQuery.eq('opportunity_type', filters.type);
                if (filters.source && filters.source !== 'all') dbQuery = dbQuery.eq('source', filters.source);
                if (filters.stage && filters.stage !== 'all') dbQuery = dbQuery.eq('current_stage', filters.stage);
                if (filters.channel && filters.channel !== 'all') dbQuery = dbQuery.eq('sales_channel', filters.channel);
                if (filters.scale && filters.scale !== 'all') dbQuery = dbQuery.eq('equipment_scale', filters.scale);
                
                if (filters.status && filters.status !== 'all') {
                    dbQuery = dbQuery.eq('current_status', filters.status);
                } else {
                    dbQuery = dbQuery.neq('current_status', '已封存');
                }
                
                if (filters.year && filters.year !== 'all') {
                    const y = parseInt(filters.year);
                    dbQuery = dbQuery.gte('created_time', `${y}-01-01T00:00:00Z`).lt('created_time', `${y + 1}-01-01T00:00:00Z`);
                }

                if (q) {
                    dbQuery = dbQuery.or(`opportunity_name.ilike.%${q}%,customer_company.ilike.%${q}%`);
                }

                // DB-First Time Filter (Previously impossible natively)
                if (filters.time && filters.time !== 'all') {
                    const timeMap = { '7': 7, '30': 30, '90': 90 };
                    const days = timeMap[filters.time];
                    if (days) {
                        const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
                        dbQuery = dbQuery.gte('effective_last_activity', threshold);
                    }
                }

                // DB-First Sorting
                const sortMap = {
                    effectiveLastActivity: 'effective_last_activity', // NATIVE!
                    opportunityName: 'opportunity_name',
                    customerCompany: 'customer_company',
                    opportunityValue: 'opportunity_value',
                    createdTime: 'created_time',
                    lastUpdateTime: 'updated_time',
                    opportunityType: 'opportunity_type',
                    opportunitySource: 'source',
                    assignee: 'owner',
                    mainContact: 'main_contact',
                    salesModel: 'sales_model',
                    salesChannel: 'sales_channel',
                    currentStage: 'current_stage',
                    currentStatus: 'current_status',
                    expectedCloseDate: 'expected_close_date',
                    deviceScale: 'equipment_scale'
                };

                const dbColumn = sortMap[sortField] || 'effective_last_activity';
                
                // [Phase 9-B.1] Add nullsFirst: false to prevent NULLs from appearing at the top when sorting DESC
                dbQuery = dbQuery.order(dbColumn, { ascending: sortDirection === 'asc', nullsFirst: false });

                if (limit && limit > 0) {
                    dbQuery = dbQuery.range(offset, offset + limit - 1);
                }

                const { data: viewData, count: viewCount, error: viewError } = await dbQuery;

                if (!viewError) {
                    // DB-First JS Filters (For JSON columns not natively mapped yet)
                    let results = (viewData || []).map(row => this._mapRowToDto(row));
                    
                    if (filters.probability && filters.probability !== 'all') {
                        results = results.filter(o => Number(o.orderProbability || o.winProbability || 0) >= Number(filters.probability));
                    }

                    if (filters.potentialSpecification && filters.potentialSpecification !== 'all') {
                        const val = filters.potentialSpecification;
                        results = results.filter(opp => {
                            const specData = opp.potentialSpecification;
                            if (!specData) return false;
                            try {
                                const parsedJson = JSON.parse(specData);
                                return typeof parsedJson === 'object' && parsedJson[val] > 0;
                            } catch (e) {
                                return typeof specData === 'string' && specData.includes(val);
                            }
                        });
                    }

                    return { data: results, total: viewCount || results.length };
                }

                // If error is anything EXCEPT missing view, throw it
                if (viewError && viewError.code !== '42P01') {
                    throw viewError; 
                }
            } catch (err) {
                if (err.code !== '42P01') {
                    console.error('[OpportunitySqlReader] View query failed:', err);
                }
            }

            // =================================================================
            // STAGE 2: LEGACY COMPATIBILITY FALLBACK
            // Executes if the v_opportunities_summary view is not deployed yet
            // =================================================================
            console.warn('[OpportunitySqlReader] View v_opportunities_summary not found. Falling back to JS aggregation.');

            const isNativeSort = sortField && sortField !== 'effectiveLastActivity';
            
            const hasJsFilters = 
                (filters.probability && filters.probability !== 'all') ||
                (filters.time && filters.time !== 'all') ||
                (filters.potentialSpecification && filters.potentialSpecification !== 'all');

            const useFastPath = isNativeSort && !hasJsFilters;

            let query = useFastPath 
                ? supabase.from(this.tableName).select('*', { count: 'exact' })
                : supabase.from(this.tableName).select('*');

            if (filters.type && filters.type !== 'all') query = query.eq('opportunity_type', filters.type);
            if (filters.source && filters.source !== 'all') query = query.eq('source', filters.source);
            if (filters.stage && filters.stage !== 'all') query = query.eq('current_stage', filters.stage);
            if (filters.channel && filters.channel !== 'all') query = query.eq('sales_channel', filters.channel);
            if (filters.scale && filters.scale !== 'all') query = query.eq('equipment_scale', filters.scale);
            
            if (filters.status && filters.status !== 'all') {
                query = query.eq('current_status', filters.status);
            } else {
                query = query.neq('current_status', '已封存');
            }
            
            if (filters.year && filters.year !== 'all') {
                const y = parseInt(filters.year);
                query = query.gte('created_time', `${y}-01-01T00:00:00Z`).lt('created_time', `${y + 1}-01-01T00:00:00Z`);
            }

            if (q) {
                query = query.or(`opportunity_name.ilike.%${q}%,customer_company.ilike.%${q}%`);
            }

            // --- SQL FAST-PATH ---
            if (useFastPath) {
                const sortMap = {
                    opportunityName: 'opportunity_name',
                    customerCompany: 'customer_company',
                    opportunityValue: 'opportunity_value',
                    createdTime: 'created_time',
                    lastUpdateTime: 'updated_time',
                    opportunityType: 'opportunity_type',
                    opportunitySource: 'source',
                    assignee: 'owner',
                    mainContact: 'main_contact',
                    salesModel: 'sales_model',
                    salesChannel: 'sales_channel',
                    currentStage: 'current_stage',
                    currentStatus: 'current_status',
                    expectedCloseDate: 'expected_close_date',
                    deviceScale: 'equipment_scale'
                };

                const dbColumn = sortMap[sortField] || 'updated_time';
                
                // [Phase 9-B.1] Add nullsFirst: false to Fallback Fast-Path as well
                query = query.order(dbColumn, { ascending: sortDirection === 'asc', nullsFirst: false });

                if (limit && limit > 0) {
                    query = query.range(offset, offset + limit - 1);
                }

                const { data, count, error } = await query;
                if (error) throw new Error(`[OpportunitySqlReader] DB Error (Fast-Path): ${error.message}`);

                return { 
                    data: (data || []).map(row => this._mapRowToDto(row)), 
                    total: count || 0 
                };
            }

            // --- FALLBACK PATH ---
            const oppsRes = await query;
            if (oppsRes.error) throw new Error(`[OpportunitySqlReader] DB Error: ${oppsRes.error.message}`);
            
            const oppIds = oppsRes.data.map(o => o.opportunity_id);
            let latestIntMap = new Map();
            
            if (oppIds.length > 0) {
                const intsRes = await supabase.from('interactions')
                    .select('opportunity_id, interaction_time, created_time')
                    .in('opportunity_id', oppIds);
                    
                if (!intsRes.error && intsRes.data) {
                    intsRes.data.forEach(int => {
                        const id = int.opportunity_id;
                        const time = new Date(int.interaction_time || int.created_time).getTime();
                        if (time && (!latestIntMap.has(id) || time > latestIntMap.get(id))) {
                            latestIntMap.set(id, time);
                        }
                    });
                }
            }

            let results = oppsRes.data.map(row => {
                const dto = this._mapRowToDto(row);
                const lastInt = latestIntMap.get(dto.opportunityId) || 0;
                if (lastInt > dto.effectiveLastActivity) {
                    dto.effectiveLastActivity = lastInt;
                }
                return dto;
            });

            if (filters.probability && filters.probability !== 'all') {
                results = results.filter(o => Number(o.orderProbability || o.winProbability || 0) >= Number(filters.probability));
            }

            if (filters.potentialSpecification && filters.potentialSpecification !== 'all') {
                const val = filters.potentialSpecification;
                results = results.filter(opp => {
                    const specData = opp.potentialSpecification;
                    if (!specData) return false;
                    try {
                        const parsedJson = JSON.parse(specData);
                        return typeof parsedJson === 'object' && parsedJson[val] > 0;
                    } catch (e) {
                        return typeof specData === 'string' && specData.includes(val);
                    }
                });
            }
            
            if (filters.time && filters.time !== 'all') {
                const timeMap = { '7': 7, '30': 30, '90': 90 };
                const days = timeMap[filters.time];
                if (days) {
                    const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
                    results = results.filter(opp => opp.effectiveLastActivity >= threshold);
                }
            }

            if (sortField) {
                 results.sort((a, b) => {
                     let valA = a[sortField];
                     let valB = b[sortField];
                     if (valA === undefined || valA === null) valA = '';
                     if (valB === undefined || valB === null) valB = '';
                     
                     if (typeof valA === 'number' && typeof valB === 'number') {
                         return sortDirection === 'asc' ? valA - valB : valB - valA;
                     }
                     return sortDirection === 'asc' 
                         ? String(valA).localeCompare(String(valB), 'zh-Hant') 
                         : String(valB).localeCompare(String(valA), 'zh-Hant');
                 });
            } else {
                 results.sort((a, b) => b.effectiveLastActivity - a.effectiveLastActivity);
            }

            const total = results.length;
            if (limit && limit > 0) {
                results = results.slice(offset, offset + limit);
            }

            return { data: results, total };

        } catch (error) {
            console.error('[OpportunitySqlReader] searchOpportunitiesTable Error:', error);
            throw error;
        }
    }

    _mapRowToDto(row) {
        if (!row) return null;

        const dto = {
            opportunityId: row.opportunity_id,
            parentOpportunityId: row.parent_opportunity_id,
            opportunityName: row.opportunity_name,
            opportunityType: row.opportunity_type,
            opportunitySource: row.source, 
            assignee: row.owner, 
            customerCompany: row.customer_company,
            mainContact: row.main_contact,
            endCustomerContact: row.end_customer_contact,
            channelContact: row.channel_contact,
            salesModel: row.sales_model,
            salesChannel: row.sales_channel,
            channelDetails: row.sales_channel, 
            currentStage: row.current_stage,
            currentStatus: row.current_status,
            expectedCloseDate: row.expected_close_date,
            orderProbability: row.win_probability, 
            opportunityValue: row.opportunity_value,
            valueCalcMode: row.value_calc_mode,
            opportunityValueType: row.value_calc_mode, 
            deviceScale: row.equipment_scale, 
            potentialSpecification: row.product_details, 
            notes: row.notes,
            driveFolderLink: row.drive_link, 
            stageHistory: row.stage_history,
            createdTime: row.created_time,
            lastUpdateTime: row.updated_time, 
            updatedBy: row.updated_by
        };

        // [Phase 9-B] Safely extract DB-First effective_last_activity if view is active
        if (row.effective_last_activity) {
            dto.effectiveLastActivity = new Date(row.effective_last_activity).getTime();
        } else {
            dto.effectiveLastActivity = new Date(dto.lastUpdateTime || dto.createdTime || 0).getTime();
        }

        return dto;
    }
}

module.exports = OpportunitySqlReader;
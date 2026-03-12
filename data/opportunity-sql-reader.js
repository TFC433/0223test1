/**
 * data/opportunity-sql-reader.js
 * [Strict Digital Forensics Mode]
 * - Type: SQL Reader (Read-Only)
 * - Target: PostgreSQL (Supabase)
 * - Table: opportunities
 * - Schema: Strict adherence to provided schema list
 * - Constraints: No rowIndex, No guessing, No update/delete
 * - Version: 1.5.0
 * - Date: 2026-03-12
 * - Changelog: Added SQL Fast-Path for native sorting and true DB-level pagination in searchOpportunitiesTable.
 */

const { supabase } = require('../config/supabase');

class OpportunitySqlReader {

    constructor() {
        this.tableName = 'opportunities';
    }

    /**
     * Get opportunity statistics (Total and This Month)
     * Phase 1 SQL Aggregation: Utilizes Supabase exact count avoiding row transmission.
     * @param {Date} startOfMonth 
     * @returns {Promise<{total: number, month: number}>}
     */
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

    /**
     * Get a single opportunity by ID
     * @param {string} opportunityId 
     * @returns {Promise<Object|null>} Opportunity DTO or null
     */
    async getOpportunityById(opportunityId) {
        if (!opportunityId) throw new Error('OpportunitySqlReader: opportunityId is required');

        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('opportunity_id', opportunityId)
                .single();

            // Ignore "Row not found" (PGRST116), throw strict on others
            if (error) {
                if (error.code === 'PGRST116') {
                    return null;
                }
                throw new Error(`[OpportunitySqlReader] DB Error: ${error.message}`);
            }

            if (!data) return null;

            return this._mapRowToDto(data);

        } catch (error) {
            console.error('[OpportunitySqlReader] getOpportunityById Error:', error);
            throw error;
        }
    }

    /**
     * Get child opportunities by parent ID
     * @param {string} parentId 
     * @returns {Promise<Array<Object>>} Array of Opportunity DTOs
     */
    async getOpportunitiesByParentId(parentId) {
        if (!parentId) throw new Error('OpportunitySqlReader: parentId is required');

        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('parent_opportunity_id', parentId);

            if (error) {
                throw new Error(`[OpportunitySqlReader] DB Error: ${error.message}`);
            }

            return data.map(row => this._mapRowToDto(row));

        } catch (error) {
            console.error('[OpportunitySqlReader] getOpportunitiesByParentId Error:', error);
            throw error;
        }
    }

    /**
     * Get opportunities by company name (fuzzy matching)
     * @param {string} companyName 
     * @returns {Promise<Array<Object>>} Array of Opportunity DTOs
     */
    async getOpportunitiesByCompanyName(companyName) {
        if (!companyName) throw new Error('OpportunitySqlReader: companyName is required');

        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .ilike('customer_company', `%${companyName}%`);

            if (error) {
                throw new Error(`[OpportunitySqlReader] DB Error: ${error.message}`);
            }

            return data.map(row => this._mapRowToDto(row));

        } catch (error) {
            console.error('[OpportunitySqlReader] getOpportunitiesByCompanyName Error:', error);
            throw error;
        }
    }

    /**
     * Get all opportunities
     * @returns {Promise<Array<Object>>} Array of Opportunity DTOs (raw array)
     */
    async getOpportunities() {
        try {
            // Fetch opportunities. Preserving select('*') because this reader handles details views as well.
            const oppsPromise = supabase.from(this.tableName).select('*');
            
            // Fetch interactions concurrently in backend with minimum projection
            const intsPromise = supabase.from('interactions').select('opportunity_id, interaction_time, created_time');

            const [oppsRes, intsRes] = await Promise.all([oppsPromise, intsPromise]);

            if (oppsRes.error) {
                throw new Error(`[OpportunitySqlReader] DB Error: ${oppsRes.error.message}`);
            }

            // Build interaction map in-memory on the backend
            const latestIntMap = new Map();
            let interactionsFailed = false;

            if (intsRes.error) {
                // Degrade Mode: Log error but do not crash the main list query
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

            // Map rows and attach effectiveLastActivity strictly as additive field
            return oppsRes.data.map(row => {
                const dto = this._mapRowToDto(row);
                
                if (!interactionsFailed) {
                    const lastInt = latestIntMap.get(dto.opportunityId) || 0;
                    // Override base effectiveLastActivity if interaction is newer
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

    /**
     * [Phase 8.11] Delegated SQL Query for Table Decoupling
     * [Phase 8.12] SQL Fast-Path for Native Sorting & True Pagination
     */
    async searchOpportunitiesTable({ q, filters = {}, sortField, sortDirection, limit, offset }) {
        try {
            const isNativeSort = sortField && sortField !== 'effectiveLastActivity';
            
            const hasJsFilters = 
                (filters.probability && filters.probability !== 'all') ||
                (filters.time && filters.time !== 'all') ||
                (filters.potentialSpecification && filters.potentialSpecification !== 'all');

            const useFastPath = isNativeSort && !hasJsFilters;

            let query = useFastPath 
                ? supabase.from(this.tableName).select('*', { count: 'exact' })
                : supabase.from(this.tableName).select('*');

            // Apply native SQL filters
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
                query = query.order(dbColumn, { ascending: sortDirection === 'asc' });

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
            // Fetch primary rows from DB
            const oppsRes = await query;
            if (oppsRes.error) throw new Error(`[OpportunitySqlReader] DB Error: ${oppsRes.error.message}`);
            
            // Compute effectiveLastActivity ONLY for the filtered subset
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

            // --- JS Fallback Filters (Non-Native fields) ---
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

            // --- Sorting (Applied in JS to support effectiveLastActivity without DDL) ---
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

            // --- Final Pagination Slice ---
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

    /**
     * Maps Raw SQL Row to DTO
     * Strict adherence to proven frontend legacy keys.
     */
    _mapRowToDto(row) {
        if (!row) return null;

        const dto = {
            // Identity
            opportunityId: row.opportunity_id,
            parentOpportunityId: row.parent_opportunity_id,

            // Core Info
            opportunityName: row.opportunity_name,
            opportunityType: row.opportunity_type,
            opportunitySource: row.source, // Mapped for frontend compatibility
            assignee: row.owner, // Mapped for frontend compatibility

            // Customer & Contacts
            customerCompany: row.customer_company,
            mainContact: row.main_contact,
            endCustomerContact: row.end_customer_contact,
            channelContact: row.channel_contact,

            // Sales Details
            salesModel: row.sales_model,
            salesChannel: row.sales_channel,
            channelDetails: row.sales_channel, // Proven legacy UI contract (opportunity-details.js)
            currentStage: row.current_stage,
            currentStatus: row.current_status,
            
            // Metrics & Values
            expectedCloseDate: row.expected_close_date,
            orderProbability: row.win_probability, // Mapped for frontend compatibility
            opportunityValue: row.opportunity_value,
            valueCalcMode: row.value_calc_mode,
            opportunityValueType: row.value_calc_mode, // Proven legacy UI contract (opportunity-details.js)
            deviceScale: row.equipment_scale, // Mapped for frontend compatibility

            // Products & Details
            potentialSpecification: row.product_details, // Proven legacy UI contract
            notes: row.notes,
            driveFolderLink: row.drive_link, // Mapped for frontend compatibility
            stageHistory: row.stage_history,

            // Metadata / Audit
            createdTime: row.created_time,
            lastUpdateTime: row.updated_time, // Mapped for frontend compatibility
            updatedBy: row.updated_by
        };

        // Initialize fallback effectiveLastActivity (epoch ms) purely based on legacy fields
        dto.effectiveLastActivity = new Date(dto.lastUpdateTime || dto.createdTime || 0).getTime();

        return dto;
    }
}

module.exports = OpportunitySqlReader;
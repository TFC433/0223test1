/**
 * data/opportunity-sql-reader.js
 * [Strict Digital Forensics Mode]
 * - Type: SQL Reader (Read-Only)
 * - Target: PostgreSQL (Supabase)
 * - Table: opportunities
 * - Schema: Strict adherence to provided schema list
 * - Constraints: No rowIndex, No guessing, No update/delete
 * - Version: 1.3.4
 * - Date: 2026-03-12
 * - Changelog: Added getOpportunitiesByCompanyName for Phase 8.1 SQL-first queries. Phase 1 SQL Aggregation: Added getOpportunityStats. Phase 8.2: Moved effectiveLastActivity computation to backend. Restored proven legacy UI contracts (channelDetails, opportunityValueType) explicitly required by opportunity-details.js.
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
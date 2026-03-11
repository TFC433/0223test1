/**
 * data/opportunity-sql-reader.js
 * [Strict Digital Forensics Mode]
 * - Type: SQL Reader (Read-Only)
 * - Target: PostgreSQL (Supabase)
 * - Table: opportunities
 * - Schema: Strict adherence to provided schema list
 * - Constraints: No rowIndex, No guessing, No update/delete
 * - Version: 1.3.0
 * - Date: 2026-03-11
 * - Changelog: Added getOpportunitiesByCompanyName for Phase 8.1 SQL-first queries. Added getOpportunitiesByParentId for scoped child queries. Phase 1 SQL Aggregation: Added getOpportunityStats.
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
     * @returns {Promise<Array<Object>>} Array of Opportunity DTOs
     */
    async getOpportunities() {
        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*');

            if (error) {
                throw new Error(`[OpportunitySqlReader] DB Error: ${error.message}`);
            }

            // Map all rows strictly
            return data.map(row => this._mapRowToDto(row));

        } catch (error) {
            console.error('[OpportunitySqlReader] getOpportunities Error:', error);
            throw error;
        }
    }

    /**
     * Maps Raw SQL Row to DTO
     * Strict adherence to provided schema.
     * snake_case -> camelCase
     */
    _mapRowToDto(row) {
        if (!row) return null;

        return {
            // Identity
            opportunityId: row.opportunity_id,
            parentOpportunityId: row.parent_opportunity_id,

            // Core Info
            opportunityName: row.opportunity_name,
            opportunityType: row.opportunity_type,
            source: row.source,
            owner: row.owner,

            // Customer & Contacts
            customerCompany: row.customer_company,
            mainContact: row.main_contact,
            endCustomerContact: row.end_customer_contact,
            channelContact: row.channel_contact,

            // Sales Details
            salesModel: row.sales_model,
            salesChannel: row.sales_channel,
            currentStage: row.current_stage,
            currentStatus: row.current_status,
            
            // Metrics & Values
            expectedCloseDate: row.expected_close_date,
            winProbability: row.win_probability,
            opportunityValue: row.opportunity_value,
            valueCalcMode: row.value_calc_mode,
            equipmentScale: row.equipment_scale,

            // Products & Details
            productDetails: row.product_details,
            notes: row.notes,
            driveLink: row.drive_link,
            stageHistory: row.stage_history,

            // Metadata / Audit
            createdTime: row.created_time,
            updatedTime: row.updated_time,
            updatedBy: row.updated_by
        };
    }
}

module.exports = OpportunitySqlReader;
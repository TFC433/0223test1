/**
 * data/company-sql-reader.js
 * [Strict Digital Forensics Mode]
 * - Type: SQL Reader (Read-Only)
 * - Target: PostgreSQL (Supabase)
 * - Table: companies
 * - Schema: Strict adherence to provided JSON schema
 * - Constraints: No rowIndex, No guessing, No update/delete
 * - Version: 1.2.0 (Performance Fix: Added getTargetCompanyEventActivities to avoid dashboard memory hydration)
 * - Date: 2026-03-12
 */

const { supabase } = require('../config/supabase');

class CompanySqlReader {

    constructor() {
        this.tableName = 'companies';
    }

    /**
     * [Compatibility Adapter]
     * Exposes getCompanyList to safely satisfy legacy CORE reader dependencies
     * without modifying service constructor signatures or internal logic.
     * Resolves TypeError: this.companyReader.getCompanyList is not a function
     * @returns {Promise<Array<Object>>}
     */
    async getCompanyList() {
        return this.getCompanies();
    }

    /**
     * Get a single company by ID
     * @param {string} companyId 
     * @returns {Promise<Object|null>} Company DTO or null
     */
    async getCompanyById(companyId) {
        if (!companyId) throw new Error('CompanySqlReader: companyId is required');

        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('company_id', companyId)
                .single();

            // Ignore "Row not found" (PGRST116), throw strict on others
            if (error) {
                if (error.code === 'PGRST116') {
                    return null;
                }
                throw new Error(`[CompanySqlReader] DB Error: ${error.message}`);
            }

            if (!data) return null;

            return this._mapRowToDto(data);

        } catch (error) {
            console.error('[CompanySqlReader] getCompanyById Error:', error);
            throw error;
        }
    }

    /**
     * Get all companies
     * @returns {Promise<Array<Object>>} Array of Company DTOs
     */
    async getCompanies() {
        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*');

            if (error) {
                throw new Error(`[CompanySqlReader] DB Error: ${error.message}`);
            }

            // Map all rows strictly
            return data.map(row => this._mapRowToDto(row));

        } catch (error) {
            console.error('[CompanySqlReader] getCompanies Error:', error);
            throw error;
        }
    }

    /**
     * [Performance Optimization]
     * Cross-domain projection: Fetches ONLY minimal activity timestamps from event_logs
     * for specifically requested company IDs. Eliminates massive memory hydration in Dashboard.
     * Avoids needing new RPC/views by utilizing standard PostgREST filtering and chunking.
     * @param {Array<string>} companyIds 
     * @returns {Promise<Array<Object>>} Array of raw DB rows: { company_id, created_time }
     */
    async getTargetCompanyEventActivities(companyIds) {
        if (!companyIds || companyIds.length === 0) return [];
        
        try {
            const chunkSize = 200; // Safe chunk size for PostgREST URL length limits
            let allData = [];

            for (let i = 0; i < companyIds.length; i += chunkSize) {
                const chunk = companyIds.slice(i, i + chunkSize);
                const { data, error } = await supabase
                    .from('event_logs')
                    .select('company_id, created_time')
                    .in('company_id', chunk);

                if (error) {
                    throw new Error(`[CompanySqlReader] DB Error fetching event activities: ${error.message}`);
                }
                if (data) {
                    allData = allData.concat(data);
                }
            }

            return allData;

        } catch (error) {
            console.error('[CompanySqlReader] getTargetCompanyEventActivities Error:', error);
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
            companyId: row.company_id,
            companyName: row.company_name,

            // Contact Info
            phone: row.phone,
            address: row.address,
            city: row.city,

            // Business Info
            description: row.description,
            companyType: row.company_type,
            customerStage: row.customer_stage,
            interactionRating: row.interaction_rating,

            // Metadata / Audit
            createdTime: row.created_time,
            updatedTime: row.updated_time,
            createdBy: row.created_by,
            updatedBy: row.updated_by
        };
    }
}

module.exports = CompanySqlReader;
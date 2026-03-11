/**
 * data/contact-sql-reader.js
 * [Strict Digital Forensics Mode]
 * - Type: SQL Reader (Read-Only)
 * - Target: PostgreSQL (Supabase)
 * - Table: contacts
 * - Schema: Strict adherence to provided JSON schema
 * - Constraints: No rowIndex, No guessing, No update/delete
 * - Version: 1.2.0
 * - Date: 2026-03-11
 * - Changelog: Added getContactsByCompanyId for Phase 8.1 SQL-first queries. Phase 1 SQL Aggregation: Added getContactStats.
 */

const { supabase } = require('../config/supabase');

class ContactSqlReader {

    constructor() {
        this.tableName = 'contacts';
    }

    /**
     * Get contact statistics (Total and This Month)
     * Phase 1 SQL Aggregation: Utilizes Supabase exact count avoiding row transmission.
     * @param {Date} startOfMonth 
     * @returns {Promise<{total: number, month: number}>}
     */
    async getContactStats(startOfMonth) {
        if (!startOfMonth) throw new Error('ContactSqlReader: startOfMonth is required');

        try {
            const startIso = startOfMonth.toISOString();

            const [totalRes, monthRes] = await Promise.all([
                supabase.from(this.tableName).select('*', { count: 'exact', head: true }),
                supabase.from(this.tableName).select('*', { count: 'exact', head: true }).gte('created_time', startIso)
            ]);

            if (totalRes.error) throw new Error(`[ContactSqlReader] DB Error (total): ${totalRes.error.message}`);
            if (monthRes.error) throw new Error(`[ContactSqlReader] DB Error (month): ${monthRes.error.message}`);

            return {
                total: totalRes.count || 0,
                month: monthRes.count || 0
            };
        } catch (error) {
            console.error('[ContactSqlReader] getContactStats Error:', error);
            throw error;
        }
    }

    /**
     * Get a single contact by ID
     * @param {string} contactId 
     * @returns {Promise<Object|null>} Contact DTO or null
     */
    async getContactById(contactId) {
        if (!contactId) throw new Error('ContactSqlReader: contactId is required');

        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('contact_id', contactId)
                .single();

            // Ignore "Row not found" (PGRST116), throw strict on others
            if (error) {
                if (error.code === 'PGRST116') {
                    return null;
                }
                throw new Error(`[ContactSqlReader] DB Error: ${error.message}`);
            }

            if (!data) return null;

            return this._mapRowToDto(data);

        } catch (error) {
            console.error('[ContactSqlReader] getContactById Error:', error);
            throw error;
        }
    }

    /**
     * Get contacts by company ID
     * @param {string} companyId 
     * @returns {Promise<Array<Object>>} Array of Contact DTOs
     */
    async getContactsByCompanyId(companyId) {
        if (!companyId) throw new Error('ContactSqlReader: companyId is required');

        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('company_id', companyId);

            if (error) {
                throw new Error(`[ContactSqlReader] DB Error: ${error.message}`);
            }

            return data.map(row => this._mapRowToDto(row));

        } catch (error) {
            console.error('[ContactSqlReader] getContactsByCompanyId Error:', error);
            throw error;
        }
    }

    /**
     * Get all contacts
     * @returns {Promise<Array<Object>>} Array of Contact DTOs
     */
    async getContacts() {
        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*');

            if (error) {
                throw new Error(`[ContactSqlReader] DB Error: ${error.message}`);
            }

            // Map all rows strictly
            return data.map(row => this._mapRowToDto(row));

        } catch (error) {
            console.error('[ContactSqlReader] getContacts Error:', error);
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
            contactId: row.contact_id,
            sourceId: row.source_id,

            // Basic Info
            name: row.name,
            companyId: row.company_id,
            department: row.department,
            jobTitle: row.job_title,

            // Contact Info
            mobile: row.mobile,
            phone: row.phone,
            email: row.email,

            // Metadata / Audit
            createdTime: row.created_time,
            updatedTime: row.updated_time,
            createdBy: row.created_by,
            updatedBy: row.updated_by
        };
    }
}

module.exports = ContactSqlReader;
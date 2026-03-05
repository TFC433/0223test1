/**
 * data/event-log-sql-reader.js
 * @version Phase 8.2b
 * @date 2026-03-05
 * @purpose Phase 8 最小修補：payload key existence override (allow clearing '')
 */

const { supabase } = require('../config/supabase');

class EventLogSqlReader {

    constructor() {
        // 定義表名與對應的 eventType (Hard Rule)
        this.tables = {
            general: 'event_logs_general',
            iot: 'event_logs_iot',
            dt: 'event_logs_dt',
            dx: 'event_logs_dx',
            summary: 'event_logs_summary'
        };
    }

    /**
     * Get a single event by ID
     * Scans all 5 tables. Throws error on DB failure.
     * @param {string} eventId 
     * @returns {Promise<Object|null>} Event DTO or null
     */
    async getEventLogById(eventId) {
        if (!eventId) throw new Error('EventLogSqlReader: eventId is required');

        try {
            // 並行查詢所有分表
            const queries = Object.entries(this.tables).map(async ([type, tableName]) => {
                const { data, error } = await supabase
                    .from(tableName)
                    .select('*')
                    .eq('event_id', eventId)
                    .maybeSingle(); // [Phase 8.2a] Use maybeSingle to avoid throw on not-found

                // Strict error handling: throw on actual DB errors, ignore not-found (data is null)
                if (error) { 
                    throw new Error(`[EventLogSqlReader] DB Error in ${tableName}: ${error.message}`);
                }
                return data ? { type, data } : null;
            });

            const results = await Promise.all(queries);
            const found = results.find(res => res !== null);

            if (!found) return null;

            return this._mapRowToDto(found.data, found.type);

        } catch (error) {
            console.error('[EventLogSqlReader] getEventLogById Error:', error);
            throw error; // Strict re-throw
        }
    }

    /**
     * Get all events
     * Unions data from all 5 tables.
     * @returns {Promise<Array<Object>>} Array of Event DTOs
     */
    async getEventLogs() {
        try {
            const queries = Object.entries(this.tables).map(async ([type, tableName]) => {
                const { data, error } = await supabase
                    .from(tableName)
                    .select('*');

                if (error) {
                    throw new Error(`[EventLogSqlReader] DB Error in ${tableName}: ${error.message}`);
                }
                
                return data.map(row => this._mapRowToDto(row, type));
            });

            const results = await Promise.all(queries);
            
            // Flatten results from all tables
            return results.flat();

        } catch (error) {
            console.error('[EventLogSqlReader] getEventLogs Error:', error);
            throw error; // Strict re-throw
        }
    }

    /**
     * Maps Raw SQL Row to DTO
     * Strict camelCase conversion based on provided schema.
     * No fallback logic. No column guessing.
     */
    _mapRowToDto(row, type) {
        if (!row) return null;

        // [Phase 8.2 Fix] Payload Parsing & Override Helper
        // 確保優先讀取 payload 中的新值，解決 DB column 未更新導致 UI 顯示舊值的問題
        let payloadObj = {};
        try {
            if (row.payload && typeof row.payload === 'object') {
                payloadObj = row.payload;
            } else if (typeof row.payload === 'string') {
                payloadObj = JSON.parse(row.payload);
            }
        } catch (e) {
            payloadObj = {};
        }

        // Helper: 若 payload 有該 key (即使是空字串)，則強制覆蓋 DB column 值
        // [Phase 8.2b Fix] Changed to hasOwnProperty check to allow clearing values ('')
        const getVal = (payloadKey, colVal) => {
            if (Object.prototype.hasOwnProperty.call(payloadObj, payloadKey)) {
                return payloadObj[payloadKey];
            }
            return colVal;
        };

        // Common Base Fields (Available in most schemas)
        const baseDto = {
            // Hard Rules
            rowIndex: null, 
            eventType: type,

            // Identity & Metadata
            eventId: row.event_id,
            creator: row.creator,
            companyId: row.company_id,
            editCount: row.edit_count,
            createdTime: row.created_time,
            lastModifiedTime: row.last_modified_time,
            
            // Core Content
            eventName: row.event_name,
            opportunityId: row.opportunity_id,
            visitPlace: row.visit_place,
            eventContent: row.event_content,
            eventNotes: row.event_notes,
            ourParticipants: row.our_participants,
            clientParticipants: row.client_participants,
            clientQuestions: row.client_questions,
            clientIntelligence: row.client_intelligence
        };

        // Type Specific Mapping (Strict Schema Adherence)
        switch (type) {
            case 'general':
                return baseDto;

            case 'iot':
                return {
                    ...baseDto,
                    // [Phase 8.2 Fix] Override specific fields from payload
                    iotStatus: getVal('iot_iotStatus', row.iot_status),
                    deviceScale: getVal('iot_deviceScale', row.device_scale),
                    lineFeatures: getVal('iot_lineFeatures', row.line_features),
                    painCategory: getVal('iot_painPoints', row.pain_category), // Frontend sends iot_painPoints
                    
                    // Additional mappings based on writer logic
                    painAnalysis: getVal('iot_painPointAnalysis', row.pain_analysis),
                    painDescription: getVal('iot_painPointDetails', row.pain_description),
                    productionStatus: getVal('iot_productionStatus', row.production_status),
                    systemArchitecture: getVal('iot_systemArchitecture', row.system_architecture)
                };

            case 'dt':
                return {
                    ...baseDto,
                    // [Phase 8.2 Fix] Override specific fields from payload
                    industry: getVal('dt_industry', row.industry),
                    deviceScale: getVal('dt_deviceScale', row.device_scale),
                    processingType: getVal('dt_processingType', row.processing_type)
                };

            case 'dx':
                return baseDto;

            case 'summary':
                // Note: Summary table has different column set in provided schema
                return {
                    // Base fields present in summary schema
                    rowIndex: null,
                    eventType: type,
                    eventId: row.event_id,
                    creator: row.creator,
                    companyId: row.company_id,
                    createdTime: row.created_time,
                    opportunityId: row.opportunity_id,
                    visitPlace: row.visit_place,
                    
                    // Summary Specific fields
                    // [Phase 8.2 Fix] Apply overrides to summary as well
                    iotStatus: getVal('iot_iotStatus', row.iot_status),
                    
                    // [Phase 8.2a Fix] Strict precedence: IoT > DT > Row
                    // Note: If iot_deviceScale exists (even empty), it overrides everything below it.
                    deviceScale: getVal('iot_deviceScale', getVal('dt_deviceScale', row.device_scale)),

                    participants: row.participants, // Note: Not 'our/client_participants' in schema
                    visitTarget: row.visit_target,
                    companyScale: row.company_scale,
                    lineFeatures: getVal('iot_lineFeatures', row.line_features),
                    painCategory: getVal('iot_painPoints', row.pain_category),
                    salesChannel: row.sales_channel,
                    demandSummary: row.demand_summary,
                    painExtraNote: row.pain_extra_note,
                    winProbability: row.win_probability,
                    opportunityName: row.opportunity_name,
                    painDescription: getVal('iot_painPointDetails', row.pain_description),
                    expectedQuantity: row.expected_quantity,
                    fanucExpectation: row.fanuc_expectation,
                    productionStatus: getVal('iot_productionStatus', row.production_status),
                    systemArchitecture: getVal('iot_systemArchitecture', row.system_architecture),
                    externalIntegration: row.external_integration
                };

            default:
                return baseDto;
        }
    }
}

module.exports = EventLogSqlReader;
/*
 * FILE: data/event-log-sql-writer.js
 * VERSION: Phase 8.7-SpecUpsert
 * DATE: 2026-03-05
 * PURPOSE:
 * - Fix PGRST204: Split payload into General vs Type-Specific updates.
 * - Always update event_logs_general.
 * - Update event_logs_{type}, OR Insert if row missing (Upsert behavior).
 */

const { supabase } = require('../config/supabase');

class EventLogSqlWriter {
  async createEventLog(payload) {
    try {
      const { data, error } = await supabase
        .from('event_logs')
        .insert([payload])
        .select('event_id')
        .single();

      if (error) throw error;
      return { success: true, id: data.event_id };
    } catch (error) {
      console.error('[EventLogSqlWriter] createEventLog Error:', error);
      throw error;
    }
  }

  async updateEventLog(eventId, payload) {
    const debug = process.env.DEBUG_EVENTLOG_WRITE === '1';
    
    try {
      // STEP 1 — detect eventType
      const eventType = payload.eventType || payload.event_type || 'general';

      // STEP 2 — determine SPEC table
      const specTableMap = {
        iot: 'event_logs_iot',
        dt: 'event_logs_dt',
        dx: 'event_logs_dx'
      };
      const specTable = specTableMap[eventType] || null;

      // STEP 3 — define GENERAL whitelist
      const GENERAL_ALLOWED = new Set([
        'event_name',
        'opportunity_id',
        'company_id',
        'our_participants',
        'client_participants',
        'visit_place',
        'event_content',
        'client_questions',
        'client_intelligence',
        'event_notes',
        'last_modified_time',
        'edit_count',
        'created_time'
      ]);

      // STEP 4 — define SPEC whitelists
      const IOT_ALLOWED = new Set([
        'iot_deviceScale',
        'iot_productionStatus',
        'iot_iotStatus',
        'iot_lineFeatures',
        'iot_painPoints',
        'iot_painPointDetails',
        'iot_painPointAnalysis',
        'iot_systemArchitecture'
      ]);

      const DT_ALLOWED = new Set([
        'device_scale',
        'industry',
        'processing_type',
        'dt_deviceScale',
        'dt_industry',
        'dt_processingType'
      ]);

      const DX_ALLOWED = new Set([]);

      const SPEC_WHITELISTS = {
        iot: IOT_ALLOWED,
        dt: DT_ALLOWED,
        dx: DX_ALLOWED
      };

      const currentSpecAllowed = SPEC_WHITELISTS[eventType] || new Set();

      // STEP 5 — split payload
      const generalPayload = {};
      const specPayload = {};

      Object.keys(payload).forEach(key => {
        // Remove meta keys
        if (['eventType', 'event_type', 'payload'].includes(key)) return;

        if (GENERAL_ALLOWED.has(key)) {
          generalPayload[key] = payload[key];
        } else if (currentSpecAllowed.has(key)) {
          specPayload[key] = payload[key];
        }
      });

      // STEP 7 — forensic logs (Pre-update)
      console.log('[EventLogSqlWriter][FORensics] detectedType=', eventType);
      console.log('[EventLogSqlWriter][FORensics] generalPayload keys=', Object.keys(generalPayload));
      console.log('[EventLogSqlWriter][FORensics] specTable=', specTable);
      console.log('[EventLogSqlWriter][FORensics] specPayload keys=', Object.keys(specPayload));

      if (debug) {
        console.log(`\n[DEBUG][Writer] updateEventLog => eventId=${eventId}`);
        console.log('[DEBUG][Writer] generalPayload:', generalPayload);
        console.log('[DEBUG][Writer] specPayload:', specPayload);
      }

      let updatedRowsGeneral = 0;
      let updatedRowsSpec = 0;
      let insertedSpecRow = false;

      // STEP 6 — update flow
      
      // 1) Always update event_logs_general (if keys exist)
      if (Object.keys(generalPayload).length > 0) {
        const { data: genData, error: genError } = await supabase
          .from('event_logs_general')
          .update(generalPayload)
          .eq('event_id', eventId)
          .select('event_id');

        if (genError) {
          console.error('[EventLogSqlWriter] General update failed:', genError);
          throw genError;
        }
        updatedRowsGeneral = genData ? genData.length : 0;
      }

      // 2) If spec table exists AND specPayload has keys: update spec table OR insert if missing
      if (specTable && Object.keys(specPayload).length > 0) {
        // A. Try UPDATE first
        const { data: specData, error: specError } = await supabase
          .from(specTable)
          .update(specPayload)
          .eq('event_id', eventId)
          .select('event_id');

        if (specError) {
          console.error('[EventLogSqlWriter] Spec update failed:', specError);
          throw specError;
        }
        updatedRowsSpec = specData ? specData.length : 0;

        // B. If UPDATE affected 0 rows, perform INSERT (Upsert behavior)
        if (updatedRowsSpec === 0) {
            console.log(`[EventLogSqlWriter] Spec update affected 0 rows. Attempting INSERT into ${specTable}...`);
            
            const insertPayload = {
                event_id: eventId,
                ...specPayload
            };

            const { error: insertError } = await supabase
                .from(specTable)
                .insert([insertPayload]);
            
            if (insertError) {
                console.error(`[EventLogSqlWriter] Spec INSERT failed into ${specTable}:`, insertError);
                throw insertError;
            }
            
            insertedSpecRow = true;
            updatedRowsSpec = 1; // Treat as successful write
        }
      }

      // Post-update Logs
      console.log('[EventLogSqlWriter][FORensics] updatedRowsGeneral=', updatedRowsGeneral);
      console.log('[EventLogSqlWriter][FORensics] updatedRowsSpec=', updatedRowsSpec);
      console.log('[EventLogSqlWriter][FORensics] insertedSpecRow=', insertedSpecRow);

      // Result Handling
      if (updatedRowsGeneral > 0 || updatedRowsSpec > 0) {
        return { success: true };
      }

      // If nothing updated, check existence in general table
      const { data: exists } = await supabase
        .from('event_logs_general')
        .select('event_id')
        .eq('event_id', eventId)
        .maybeSingle();

      if (!exists) {
        return {
          success: false,
          message: 'Event not found (or RLS restricted).'
        };
      }

      return {
        success: true, // Content matched, no changes needed
        message: 'No rows updated (data unchanged).'
      };

    } catch (error) {
      console.error('[EventLogSqlWriter] updateEventLog Error:', error);
      throw error;
    }
  }

  async deleteEventLog(eventId) {
    try {
      const { data, error } = await supabase
        .from('event_logs')
        .delete()
        .eq('event_id', eventId)
        .select('event_id');

      if (error) throw error;
      if (!data || data.length === 0) {
        return { success: false, message: 'Event not found' };
      }
      return { success: true };
    } catch (error) {
      console.error('[EventLogSqlWriter] deleteEventLog Error:', error);
      throw error;
    }
  }
}

module.exports = EventLogSqlWriter;
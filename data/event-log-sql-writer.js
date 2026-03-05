/*
 * FILE: data/event-log-sql-writer.js
 * VERSION: Phase 8.4x-SafeUpdate
 * DATE: 2026-03-05
 * PURPOSE:
 * - Fix PGRST204: Strip known non-column fields (event_type, payload) before update.
 * - Maintain Step 1 scanning logic.
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
    
    // Step 1: Scan candidate tables to find the correct partition
    const candidateTables = ['event_logs_general', 'event_logs_iot', 'event_logs_dt', 'event_logs_dx'];
    let targetTable = null;

    try {
      // Scan tables to find where the event exists
      for (const table of candidateTables) {
        const { data } = await supabase
          .from(table)
          .select('event_id')
          .eq('event_id', eventId)
          .maybeSingle();

        if (data) {
          targetTable = table;
          break;
        }
      }

      // PATCH: Create safe payload by removing non-column fields that cause PGRST204
      const safePayload = { ...payload };
      delete safePayload.event_type;
      delete safePayload.payload;

      // 1) Forensic Logs (After targetTable determined)
      console.log('[EventLogSqlWriter][FORensics] targetTable=', targetTable);
      console.log('[EventLogSqlWriter][FORensics] payload keys=', Object.keys(safePayload));

      if (debug) {
        console.log(`\n[DEBUG][Writer] updateEventLog => eventId=${eventId}, targetTable=${targetTable}`);
        console.log('[DEBUG][Writer] update payload keys:', Object.keys(safePayload));
      }

      if (!targetTable) {
        return { 
          success: false, 
          message: 'Event not found in any known partition (general, iot, dt, dx).' 
        };
      }

      // 2) Attempt update on the specific target table with SAFE payload
      const { data: updated, error: updateErr } = await supabase
        .from(targetTable)
        .update(safePayload)
        .eq('event_id', eventId)
        .select('event_id');

      if (updateErr) {
        // 2) Forensic Log (On Error)
        console.error('[EventLogSqlWriter][FORensics] Supabase updateErr=', updateErr);
        if (debug) console.error('[DEBUG][Writer] updateErr:', updateErr);
        throw updateErr;
      }

      const updatedRows = Array.isArray(updated) ? updated.length : 0;

      // 3) Forensic Log (After Result)
      console.log('[EventLogSqlWriter][FORensics] updatedRows=', updatedRows);

      if (debug) {
        console.log('[DEBUG][Writer] updatedRows:', updatedRows);
      }

      if (updatedRows > 0) {
        return { success: true };
      }

      // 3) Hard-proof: check visibility under SAME supabase client on the SPECIFIC table
      // If RLS blocks SELECT, this may return null data without error.
      const { data: visibleRow, error: selectErr } = await supabase
        .from(targetTable)
        .select('event_id')
        .eq('event_id', eventId)
        .maybeSingle();

      if (debug) {
        console.log('[DEBUG][Writer] visibility check => data:', visibleRow, 'error:', selectErr || null);
      }

      // If select errors, it's a DB/api issue (not just RLS)
      if (selectErr) {
        return {
          success: false,
          message: `Update=0 and visibility check errored: ${selectErr.message}`
        };
      }

      if (!visibleRow) {
        // Either truly not exist OR RLS blocks even SELECT
        return {
          success: false,
          message: 'Update affected 0 rows. Row not visible to this DB client (NOT FOUND or RLS blocks SELECT).'
        };
      }

      // Row is visible but update affected 0 => classic RLS update policy mismatch
      return {
        success: false,
        message: 'Row is visible but UPDATE affected 0 rows. Highly likely RLS/Policy blocks UPDATE.'
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
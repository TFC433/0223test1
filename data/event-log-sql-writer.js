/*
 * FILE: data/event-log-sql-writer.js
 * VERSION: Phase 8.3x-debug-hardproof
 * DATE: 2026-03-05
 * PURPOSE:
 * - Hard-proof update result: distinguish NOT FOUND vs RLS/POLICY block.
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
      if (debug) {
        console.log(`\n[DEBUG][Writer] updateEventLog => eventId=${eventId}`);
        console.log('[DEBUG][Writer] update payload keys:', Object.keys(payload));
      }

      // 1) Attempt update with returning
      const { data: updated, error: updateErr } = await supabase
        .from('event_logs')
        .update(payload)
        .eq('event_id', eventId)
        .select('event_id');

      if (updateErr) {
        if (debug) console.error('[DEBUG][Writer] updateErr:', updateErr);
        throw updateErr;
      }

      const updatedRows = Array.isArray(updated) ? updated.length : 0;

      if (debug) {
        console.log('[DEBUG][Writer] updatedRows:', updatedRows);
      }

      if (updatedRows > 0) {
        return { success: true };
      }

      // 2) Hard-proof: check visibility under SAME supabase client (important!)
      // If RLS blocks SELECT, this may return null data without error.
      const { data: visibleRow, error: selectErr } = await supabase
        .from('event_logs')
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
        // Either truly not exist OR RLS blocks even SELECT (common)
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
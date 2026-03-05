/*
 * FILE: services/event-log-service.js
 * VERSION: 8.3.1
 * DATE: 2026-03-05
 * CHANGELOG:
 * - Phase 8: Align EventLog payload to SQL schema (event_logs).
 * - Remove non-existent columns mapping (content_summary/content/recorder/event_title...).
 * - Always bump last_modified_time and edit_count on update to avoid "no changes made".
 * - Store type-specific fields (iot_*, dt_*, dx_*) into payload (jsonb).
 * - Keep deprecated sheet readers only for optional cache invalidation (no fallback reads/writes).
 */

class EventLogService {
  /**
   * @param {EventLogReader} eventReader (Deprecated)
   * @param {OpportunityReader} oppReader (Deprecated)
   * @param {CompanyReader} companyReader (Deprecated)
   * @param {SystemReader} systemReader
   * @param {CalendarService} calendarService
   * @param {EventLogSqlReader} eventLogSqlReader
   * @param {EventLogSqlWriter} eventLogSqlWriter
   */
  constructor(
    eventReader,
    oppReader,
    companyReader,
    systemReader,
    calendarService,
    eventLogSqlReader,
    eventLogSqlWriter
  ) {
    // Deprecated (kept only for legacy cache invalidation safety)
    this.eventReader = eventReader;

    this.systemReader = systemReader;
    this.calendarService = calendarService;

    // SQL (authoritative for Event Logs)
    this.eventLogSqlReader = eventLogSqlReader;
    this.eventLogSqlWriter = eventLogSqlWriter;
  }

  // -----------------------------
  // Internal helpers
  // -----------------------------

  _invalidateEventCacheSafe() {
    try {
      if (this.eventReader && typeof this.eventReader.invalidateCache === 'function') {
        this.eventReader.invalidateCache('eventLogs');
      } else if (this.eventReader && this.eventReader.cache) {
        this.eventReader.cache = {};
      }
    } catch (e) {
      // do nothing
    }
  }

  _isRowIndexLike(idOrRowIndex) {
    return (
      typeof idOrRowIndex === 'number' ||
      (typeof idOrRowIndex === 'string' && idOrRowIndex.trim() !== '' && !isNaN(Number(idOrRowIndex)))
    );
  }

  _normalizeIsoOrNow(value) {
    const d = value ? new Date(value) : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  }

  /**
   * Extract type-specific fields into payload jsonb.
   * We keep keys as-is (iot_xxx / dt_xxx / dx_xxx...) to avoid assumptions.
   * Also allows future form expansion without DB migration.
   */
  _extractDynamicPayload(data) {
    const payload = {};

    if (!data || typeof data !== 'object') return payload;

    const SKIP_KEYS = new Set([
      // core/common fields (exist as real columns)
      'eventId', 'id',
      'eventName', 'eventTitle',
      'opportunityId',
      'companyId',
      'creator',
      'createdTime',
      'lastModifiedTime',
      'ourParticipants',
      'clientParticipants',
      'visitPlace',
      'eventContent',
      'clientQuestions',
      'clientIntelligence',
      'eventNotes',
      'editCount',
      'eventType',
      // misc flags
      'syncToCalendar'
    ]);

    for (const [k, v] of Object.entries(data)) {
      if (SKIP_KEYS.has(k)) continue;
      if (v === undefined) continue;
      payload[k] = v;
    }

    return payload;
  }

  /**
   * Map incoming camelCase to SQL column names for event_logs table.
   * NOTE: We only map to columns that are confirmed to exist in your schema.
   */
  _mapToSqlColumnsForUpsert(data, { creator, createdTime, lastModifiedTime, editCount, payload }) {
    const sql = {
      // Required identity
      event_id: data.eventId || data.id,

      // Core columns
      event_name: data.eventName || data.eventTitle || null,
      opportunity_id: data.opportunityId || null,
      company_id: data.companyId || null,
      creator: creator || data.creator || null,

      created_time: createdTime,
      last_modified_time: lastModifiedTime,

      our_participants: data.ourParticipants ?? null,
      client_participants: data.clientParticipants ?? null,
      visit_place: data.visitPlace ?? null,

      event_content: data.eventContent ?? null,
      client_questions: data.clientQuestions ?? null,
      client_intelligence: data.clientIntelligence ?? null,
      event_notes: data.eventNotes ?? null,

      edit_count: editCount,
      event_type: data.eventType ?? null,

      payload: payload || {}
    };

    return sql;
  }

  // -----------------------------
  // Reads (SQL-only)
  // -----------------------------

  async getAllEvents() {
    if (!this.eventLogSqlReader) {
      throw new Error('[Phase 8] EventLogSqlReader not injected (SQL-only required)');
    }
    const events = await this.eventLogSqlReader.getEventLogs();
    return Array.isArray(events) ? events : [];
  }

  async getEventById(eventId) {
    if (!this.eventLogSqlReader) {
      throw new Error('[Phase 8] EventLogSqlReader not injected (SQL-only required)');
    }
    const data = await this.eventLogSqlReader.getEventLogById(eventId);
    return data || null;
  }

  // -----------------------------
  // Writes (SQL-only)
  // -----------------------------

  async createEvent(data, user) {
    if (!this.eventLogSqlWriter) {
      throw new Error('[Phase 8] EventLogSqlWriter not injected (SQL-only required)');
    }

    const creator = user?.displayName || user?.username || user?.name || 'System';

    // Validate or Generate ID
    const eventId = data?.eventId || data?.id || `EVT${Date.now()}`;

    const created = this._normalizeIsoOrNow(data?.createdTime);
    const payload = this._extractDynamicPayload(data);

    const sqlPayload = this._mapToSqlColumnsForUpsert(
      { ...(data || {}), eventId },
      {
        creator,
        createdTime: created,
        lastModifiedTime: created,
        editCount: 1,
        payload
      }
    );

    const result = await this.eventLogSqlWriter.createEventLog(sqlPayload);
    this._invalidateEventCacheSafe();

    // Optional calendar side effect (kept)
    if (result?.success && data?.syncToCalendar === 'true') {
      try {
        const startIso = new Date(sqlPayload.created_time).toISOString();
        const endIso = new Date(Date.now() + 3600000).toISOString();

        const calendarEvent = {
          summary: `[${sqlPayload.event_type || 'event'}] ${sqlPayload.event_name || ''}`,
          description: sqlPayload.event_content || '',
          start: { dateTime: startIso },
          end: { dateTime: endIso }
        };

        if (this.calendarService?.createEvent) {
          await this.calendarService.createEvent(calendarEvent);
        }
      } catch (calError) {
        console.warn('[EventLogService] Calendar sync failed:', calError);
      }
    }

    return result;
  }

  async updateEventLog(idOrRowIndex, data, modifier) {
    if (!this.eventLogSqlWriter) {
      throw new Error('[Phase 8] EventLogSqlWriter not injected (SQL-only required)');
    }
    if (!this.eventLogSqlReader) {
      throw new Error('[Phase 8] EventLogSqlReader not injected (SQL-only required)');
    }

    // Phase 7 rule: forbid rowIndex
    if (this._isRowIndexLike(idOrRowIndex)) {
      throw new Error('[Phase 7] RowIndex is strictly prohibited. Use Event ID.');
    }

    const eventId = idOrRowIndex;
    const editor = modifier?.displayName || modifier?.username || modifier?.name || modifier || 'System';

    // Load existing to ensure edit_count increments + payload merge
    const existing = await this.eventLogSqlReader.getEventLogById(eventId);
    if (!existing) {
      return { success: false, message: `Event not found (event_id=${eventId})` };
    }

    const lastModified = new Date(); // always change something
    const nextEditCount = Number(existing.editCount ?? existing.edit_count ?? 0) + 1;

    // Merge payload (existing.payload + new dynamic fields)
    const existingPayload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
    const incomingDynamic = this._extractDynamicPayload(data);
    const mergedPayload = { ...existingPayload, ...incomingDynamic, lastEditor: editor };

    // Build update payload ONLY with existing columns
    const updateSql = {
      // Optional updates (only if provided)
      ...(data?.eventName !== undefined || data?.eventTitle !== undefined
        ? { event_name: data.eventName ?? data.eventTitle ?? null }
        : {}),

      ...(data?.opportunityId !== undefined ? { opportunity_id: data.opportunityId } : {}),
      ...(data?.companyId !== undefined ? { company_id: data.companyId } : {}),
      ...(data?.eventType !== undefined ? { event_type: data.eventType } : {}),

      ...(data?.ourParticipants !== undefined ? { our_participants: data.ourParticipants } : {}),
      ...(data?.clientParticipants !== undefined ? { client_participants: data.clientParticipants } : {}),
      ...(data?.visitPlace !== undefined ? { visit_place: data.visitPlace } : {}),

      ...(data?.eventContent !== undefined ? { event_content: data.eventContent } : {}),
      ...(data?.clientQuestions !== undefined ? { client_questions: data.clientQuestions } : {}),
      ...(data?.clientIntelligence !== undefined ? { client_intelligence: data.clientIntelligence } : {}),
      ...(data?.eventNotes !== undefined ? { event_notes: data.eventNotes } : {}),

      // ALWAYS bump these to avoid "no changes made"
      last_modified_time: lastModified,
      edit_count: nextEditCount,

      // payload merge
      payload: mergedPayload
    };

    const result = await this.eventLogSqlWriter.updateEventLog(eventId, updateSql);
    this._invalidateEventCacheSafe();

    return result;
  }

  async deleteEventLog(eventId, user) {
    if (!this.eventLogSqlWriter) {
      throw new Error('[Phase 8] EventLogSqlWriter not injected (SQL-only required)');
    }
    const modifier = user?.displayName || user?.username || user?.name || user || 'System';

    // (Optional) record deleter in payload is impossible here without schema change; keep simple.
    const result = await this.eventLogSqlWriter.deleteEventLog(eventId, modifier);
    this._invalidateEventCacheSafe();
    return result;
  }

  async getEventTypes() {
    try {
      const config = await this.systemReader.getSystemConfig();
      return config['事件類型'] || [];
    } catch (error) {
      console.error('[EventLogService] getEventTypes Error:', error);
      return [];
    }
  }
}

module.exports = EventLogService;
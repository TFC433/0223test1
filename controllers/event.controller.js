/**
 * controllers/event.controller.js
 * @version Phase 8.3e
 * @date 2026-04-15
 * @description
 * [Phase 8 SQL-Only Fix]
 * - Added getDashboardData to serve events dashboard via SQL
 * - Added forensics logging for PUT updates (iot/dt fields) under DEBUG_EVENTLOG_WRITE=1
 * - [Patch] Automatically create an interaction record during Event Report creation to populate the opportunity timeline.
 */

const { handleApiError } = require('../middleware/error.middleware');

// 輔助函式：從 req.app 獲取服務
const getServices = (req) => req.app.get('services');

// ==========================================
// Part 1: 事件紀錄 (Event Log) 相關功能
// ==========================================

// GET /api/events/dashboard
exports.getDashboardData = async (req, res) => {
  try {
    const { dashboardService } = getServices(req);
    const data = await dashboardService.getEventsDashboardData();

    const safeData = {
      eventList: Array.isArray(data.eventList) ? data.eventList : [],
      chartData: data.chartData || {}
    };

    res.json({ success: true, data: safeData });
  } catch (error) {
    handleApiError(res, error, 'Get Events Dashboard');
  }
};

// POST /api/events
exports.createEventLog = async (req, res) => {
  try {
    if (process.env.DEBUG_EVENTLOG_WRITE === '1') {
      console.log('[DEBUG][EventController] CREATE Payload Keys:', Object.keys(req.body || {}));
    }

    const services = getServices(req);
    const result = await services.eventLogService.createEvent(req.body, { displayName: req.user.name });

    // [Patch] Automatically create an interaction record so the Event Report appears in the timeline.
    if (result && result.success) {
      const eventId = result.id || result.eventId;
      if (eventId && services.interactionService) {
        const oppId = req.body.opportunityId;
        const compId = req.body.companyId;

        // Only create an interaction if there is a target context to link it to
        if (oppId || compId) {
          try {
            const eventName = req.body.eventName || req.body.eventTitle || '未命名報告';
            // Maintain legacy regex pattern: [Text](event_log_id=ID) to ensure frontend clickability
            const summary = `[查看事件報告詳情](event_log_id=${eventId})`;

            await services.interactionService.createInteraction({
              opportunityId: oppId,
              companyId: compId,
              interactionTime: req.body.createdTime || new Date().toISOString(),
              eventType: '事件報告',
              eventTitle: eventName,
              contentSummary: summary,
              recorder: req.user.name
            }, { displayName: req.user.name });
          } catch (intErr) {
            console.warn('[EventController] Warning: Failed to create linked interaction for Event Report:', intErr.message);
          }
        }
      }
    }

    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Create Event Log');
  }
};

// GET /api/events/:eventId
exports.getEventLogById = async (req, res) => {
  try {
    const { eventLogService } = getServices(req);
    const data = await eventLogService.getEventById(req.params.eventId);
    res.json({ success: !!data, data });
  } catch (error) {
    handleApiError(res, error, 'Get Event Log By Id');
  }
};

// PUT /api/events/:eventId
exports.updateEventLog = async (req, res) => {
  try {
    if (process.env.DEBUG_EVENTLOG_WRITE === '1') {
      console.log(`\n[DEBUG][EventController] UPDATE ${req.params.eventId}`);
      console.log('[DEBUG][EventController] Content-Type:', req.get('Content-Type'));
      console.log('[DEBUG][EventController] Body Keys:', Object.keys(req.body || {}));

      const checkKeys = [
        'eventName', 'visitPlace', 'eventType',
        'iot_deviceScale', 'iot_iotStatus', 'iot_painPoints', 'iot_lineFeatures',
        'iot_productionStatus', 'iot_systemArchitecture', 'iot_painPointDetails', 'iot_painPointAnalysis',
        'dt_deviceScale', 'dt_processingType', 'dt_industry'
      ];

      const found = {};
      for (const k of checkKeys) {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
          found[k] = req.body[k];
        }
      }
      console.log('[DEBUG][EventController] Key Presence Sample:', found);
    }

    const { eventLogService } = getServices(req);
    res.json(
      await eventLogService.updateEventLog(
        req.params.eventId,
        req.body,
        req.user.name
      )
    );
  } catch (error) {
    handleApiError(res, error, 'Update Event Log');
  }
};

// DELETE /api/events/:eventId
exports.deleteEventLog = async (req, res) => {
  try {
    const { eventLogService } = getServices(req);
    res.json(await eventLogService.deleteEventLog(req.params.eventId, req.user.name));
  } catch (error) {
    handleApiError(res, error, 'Delete Event Log');
  }
};

// ==========================================
// Part 2: 日曆 (Calendar) 與 自動同步功能
// ==========================================

exports.createCalendarEvent = async (req, res) => {
  try {
    const { eventService } = getServices(req);
    const result = await eventService.createCalendarEventAndSync(req.body, req.user);
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Create Calendar Event & Sync');
  }
};

exports.getThisWeekEvents = async (req, res) => {
  try {
    const { eventService } = getServices(req);
    res.json(await eventService.getThisWeekEvents());
  } catch (error) {
    handleApiError(res, error, 'Get Week Events');
  }
};
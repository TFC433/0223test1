/**
 * @version Phase 8 Production (8.4p1)
 * @date 2026-03-05
 * @changelog
 *  - Fix: Prevent double submit (remove click-submit duplicate; add _isSubmitting guard)
 *  - Fix: Treat authedFetch PUT success even if response body is empty (res undefined / 204)
 *  - Fix: Success UX order (close → toast → refresh; navigate only if truly on #event-editor)
 * @purpose Phase 8 收尾用 Production：確保儲存不會重複觸發、PUT 送出且不被誤判失敗、UI 體感穩定
 */

// public/scripts/events/event-editor-standalone.js

console.log('%c[EventEditorStandalone] LOADED Phase 8 PRODUCTION (8.4p1) 2026-03-05', 'color:#22c55e;font-weight:bold;');

window._DEBUG_EDITOR_OPEN_COUNT ||= 0;

const EventEditorStandalone = (() => {
  let _modal, _form, _inputs = {};

  let _data = {
    ourParticipants: new Set(),
    clientParticipants: new Set()
  };

  let _isInitialized = false;
  let _resizeObserver = null;

  let _isOpening = false;
  let _originalOverflow = { body: '', html: '' };

  // ✅ Prevent double submit / re-entry
  let _isSubmitting = false;

  const DEFAULT_OPTIONS = {
    lineFeatures: ['工具機', 'ROBOT', '傳產機', 'PLC'],
    painPoints: ['Monitoring', 'Improve OEE', 'Reduce Man-hours', 'Others']
  };

  async function _ensureTemplateLoaded() {
    if (document.getElementById('standalone-event-modal')) return;

    try {
      const response = await fetch('/views/event-editor.html');
      if (!response.ok) throw new Error('無法下載編輯器模板');
      let html = await response.text();

      // Remove script tags to avoid duplicate init
      html = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "");

      const container = document.getElementById('modal-container') || document.body;
      container.insertAdjacentHTML('beforeend', html);
    } catch (e) {
      console.error('[EventEditorStandalone] Template load failed:', e);
      throw e;
    }
  }

  function _refreshDomRefs() {
    _modal = document.getElementById('standalone-event-modal');
    _form = document.getElementById('standalone-event-form');

    _inputs = {
      id: document.getElementById('standalone-eventId'),
      oppId: document.getElementById('standalone-opportunityId'),
      compId: document.getElementById('standalone-companyId'),
      type: document.getElementById('standalone-type'),
      name: document.getElementById('standalone-name'),
      time: document.getElementById('standalone-createdTime'),
      location: document.getElementById('standalone-location'),

      content: document.getElementById('standalone-content'),
      questions: document.getElementById('standalone-questions'),
      intelligence: document.getElementById('standalone-intelligence'),
      notes: document.getElementById('standalone-notes'),

      ourContainer: document.getElementById('standalone-our-participants-container'),
      manualOur: document.getElementById('standalone-manual-our-participants'),
      clientContainer: document.getElementById('standalone-client-participants-container'),
      manualClient: document.getElementById('standalone-manual-participants'),

      specificWrapper: document.getElementById('standalone-specific-wrapper'),
      specificCard: document.getElementById('specific-info-card'),
      specificTitle: document.getElementById('specific-card-title'),
      specificContainer: document.getElementById('standalone-specific-container'),
      workspaceGrid: document.getElementById('workspace-container'),

      submitBtn: document.getElementById('standalone-submit-btn'),
      deleteBtn: document.getElementById('standalone-delete-btn'),
      closeBtn: document.getElementById('standalone-close-btn')
    };
  }

  function _initOnce() {
    if (_isInitialized) return;

    if (!_resizeObserver) {
      _resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
          if (entry.target.offsetParent !== null) {
            _autoResize(entry.target);
            _resizeObserver.unobserve(entry.target);
          }
        }
      });
    }

    _isInitialized = true;
  }

  // ✅ Important: bind only via form submit (avoid click+submit double fire)
  function _bindDomEvents() {
    if (_inputs.closeBtn) _inputs.closeBtn.onclick = _close;

    if (_form) {
      // remove legacy onsubmit if any
      _form.onsubmit = null;

      // Ensure we don't attach duplicates
      _form.removeEventListener('submit', _handleSubmit);
      _form.addEventListener('submit', _handleSubmit);

      _form.removeEventListener('input', _onFormInput);
      _form.addEventListener('input', _onFormInput);
    }
  }

  function _onFormInput(e) {
    if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'textarea') {
      _autoResize(e.target);
    }
  }

  function _autoResize(element) {
    if (!element) return;

    if (element.offsetParent === null) {
      if (_resizeObserver) _resizeObserver.observe(element);
      return;
    }

    element.style.height = 'auto';
    element.style.height = element.scrollHeight + 'px';
  }

  function _lockScroll() {
    _originalOverflow.body = document.body.style.overflow;
    _originalOverflow.html = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  function _unlockScroll() {
    document.body.style.overflow = _originalOverflow.body;
    document.documentElement.style.overflow = _originalOverflow.html;
  }

  function _setLoading(isLoading, text) {
    if (!_inputs.submitBtn) return;
    _inputs.submitBtn.disabled = !!isLoading;
    _inputs.submitBtn.textContent = isLoading ? (text || '處理中...') : '儲存';
  }

  function _resetForm() {
    if (_form) _form.reset();

    _data.ourParticipants.clear();
    _data.clientParticipants.clear();

    if (_inputs.specificContainer) _inputs.specificContainer.innerHTML = '';
    if (_inputs.specificWrapper) _inputs.specificWrapper.style.display = 'none';
    if (_inputs.workspaceGrid) _inputs.workspaceGrid.classList.remove('has-sidebar');

    _setLoading(false);
    _isSubmitting = false;
  }

  async function open(eventId) {
    if (_isOpening) return;
    _isOpening = true;

    window._DEBUG_EDITOR_OPEN_COUNT++;
    console.log(`[Forensics] EventEditorStandalone.open called (Count: ${window._DEBUG_EDITOR_OPEN_COUNT})`, { eventId });

    try {
      await _ensureTemplateLoaded();
      _initOnce();

      _refreshDomRefs();

      if (!_modal || !_form) {
        console.error('[EventEditorStandalone] Missing modal/form DOM after template load');
        showNotification('編輯器初始化失敗', 'error');
        return;
      }

      _bindDomEvents();

      _resetForm();

      _modal.style.display = 'block';
      _lockScroll();

      if (eventId) {
        _setLoading(true, '載入中...');

        let eventData = null;
        try {
          const result = await authedFetch(`/api/events/${eventId}`);
          if (result && result.success) eventData = result.data;
          else throw new Error(result?.error || 'Unknown Error');
        } catch (fetchError) {
          console.error('[EventEditorStandalone] Main event fetch failed:', fetchError);
          showNotification('無法載入事件: ' + (fetchError?.message || fetchError), 'error');
          _close();
          return;
        }

        if (_inputs.deleteBtn) {
          _inputs.deleteBtn.style.display = 'block';
          _inputs.deleteBtn.onclick = () => _confirmDelete(eventData.eventId, eventData.eventName);
        }

        try {
          await _populateForm(eventData);
        } catch (populateError) {
          console.error('[EventEditorStandalone] Partial population failure:', populateError);
          showNotification('關聯資料載入異常，但您仍可編輯主要內容', 'warning');
        } finally {
          _setLoading(false);
        }
      } else {
        if (_inputs.deleteBtn) _inputs.deleteBtn.style.display = 'none';
        await _applyTypeSwitch('general', {});
        _setLoading(false);
      }

    } catch (e) {
      console.error('[EventEditorStandalone] open unexpected error:', e);
      showNotification('發生未預期錯誤', 'error');
      _close();
    } finally {
      _isOpening = false;
      // Do not force _setLoading(false) here; open() already manages it per mode.
    }
  }

  async function _populateForm(eventData) {
    if (_inputs.id) _inputs.id.value = eventData.eventId || '';
    if (_inputs.oppId) _inputs.oppId.value = eventData.opportunityId || '';
    if (_inputs.compId) _inputs.compId.value = eventData.companyId || '';
    if (_inputs.name) _inputs.name.value = eventData.eventName || '';
    if (_inputs.location) _inputs.location.value = eventData.visitPlace || '';

    if (_inputs.content) _inputs.content.value = eventData.eventContent || '';
    if (_inputs.questions) _inputs.questions.value = eventData.clientQuestions || '';
    if (_inputs.intelligence) _inputs.intelligence.value = eventData.clientIntelligence || '';
    if (_inputs.notes) _inputs.notes.value = eventData.eventNotes || '';

    [_inputs.content, _inputs.questions, _inputs.intelligence, _inputs.notes].forEach(el => {
      if (el) _autoResize(el);
    });

    if (_inputs.time && eventData.createdTime) {
      const date = new Date(eventData.createdTime);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      _inputs.time.value = date.toISOString().slice(0, 16);
    }

    const eventType = eventData.eventType || 'general';
    const typeToSelect = eventType === 'legacy' ? 'iot' : eventType;
    await _applyTypeSwitch(typeToSelect, eventData);

    _data.ourParticipants.clear();
    const ourManualList = [];
    const teamMembers = window.CRM_APP?.systemConfig?.['團隊成員'] || [];
    const teamNames = new Set(teamMembers.map(m => m.note));

    (eventData.ourParticipants || '').split(',').map(p => p.trim()).filter(Boolean).forEach(p => {
      if (teamNames.has(p)) _data.ourParticipants.add(p);
      else ourManualList.push(p);
    });
    _renderPillSelector('our', _inputs.ourContainer, teamMembers, _data.ourParticipants);
    if (_inputs.manualOur) _inputs.manualOur.value = ourManualList.join(', ');

    _data.clientParticipants.clear();
    const clientList = (eventData.clientParticipants || '').split(',').map(p => p.trim()).filter(Boolean);
    await _fetchAndPopulateClientParticipants(eventData.opportunityId, eventData.companyId, clientList);
  }

  function selectType(newType) {
    const currentType = _inputs.type?.value;
    if (currentType === newType) return;

    const container = _inputs.specificContainer;
    let hasData = false;
    let mergedData = '';

    if (container) {
      container.querySelectorAll('input[type="text"], textarea').forEach(el => {
        if (el.value && el.value.trim()) {
          hasData = true;
          const label = el.closest('.form-group')?.querySelector('label')?.textContent || el.name;
          mergedData += `● ${label}：\n${el.value}\n\n`;
        }
      });
      container.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked').forEach(el => {
        hasData = true;
        let label = el.name;
        const groupLabel = el.closest('.form-group')?.querySelector('.iso-label');
        if (groupLabel) label = groupLabel.textContent;
        mergedData += `● ${label}：${el.value}\n\n`;
      });
    }

    if (hasData) {
      showConfirmDialog(
        `切換類型將移除目前專屬欄位資料，是否繼續？\n(舊資料將自動備份至備註)`,
        () => {
          const currentNotes = _inputs.notes?.value || '';
          const nowStr = new Date().toLocaleString();
          const backupBlock =
            `\n----------------------------------------\n【系統自動備份】 (${nowStr})\n原類型：${currentType}\n\n${mergedData}----------------------------------------\n`;

          if (_inputs.notes) {
            _inputs.notes.value = currentNotes + backupBlock;
            _autoResize(_inputs.notes);
          }

          _applyTypeSwitch(newType, {});
        }
      );
    } else {
      _applyTypeSwitch(newType, {});
    }
  }

  async function _applyTypeSwitch(newType, eventData) {
    const grid = document.querySelector('#standalone-event-modal .type-select-grid');
    if (grid) {
      grid.querySelectorAll('.type-select-card').forEach(el => el.classList.remove('selected'));
      const target = grid.querySelector(`.type-select-card[data-type="${newType}"]`);
      if (target) target.classList.add('selected');
    }

    if (_inputs.type) _inputs.type.value = newType;

    _updateSpecificCardColor(newType);

    if (_inputs.specificContainer) _inputs.specificContainer.innerHTML = '';

    if (newType === 'general') {
      if (_inputs.specificWrapper) _inputs.specificWrapper.style.display = 'none';
      if (_inputs.workspaceGrid) _inputs.workspaceGrid.classList.remove('has-sidebar');
    } else {
      if (_inputs.specificWrapper) _inputs.specificWrapper.style.display = 'block';
      if (_inputs.workspaceGrid) _inputs.workspaceGrid.classList.add('has-sidebar');

      if (newType === 'iot') {
        _renderIoTFields(eventData || {});
      } else if (newType === 'dt') {
        _renderSimpleFields(
          eventData || {},
          ['dt_deviceScale', 'dt_processingType', 'dt_industry'],
          ['設備規模', '加工類型', '加工產業別'],
          ['例：預計導入機台數、場域大小...', '例：CNC、射出成型、組裝...', '例：航太、半導體、車用...']
        );
      } else {
        if (_inputs.specificContainer) {
          _inputs.specificContainer.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">無專屬欄位設定</p>';
        }
      }

      if (_inputs.specificContainer) {
        _inputs.specificContainer.querySelectorAll('textarea').forEach(el => _autoResize(el));
      }
    }
  }

  function _updateSpecificCardColor(type) {
    const config = window.CRM_APP?.systemConfig?.['事件類型'] || [];
    const typeConfig = config.find(t => t.value === type);
    const baseColor = typeConfig?.color || '#64748b';

    if (_inputs.specificCard) {
      _inputs.specificCard.style.backgroundColor = `color-mix(in srgb, ${baseColor} 5%, white)`;
      _inputs.specificCard.style.borderColor = `color-mix(in srgb, ${baseColor} 20%, white)`;
    }
    if (_inputs.specificTitle) {
      _inputs.specificTitle.style.color = baseColor;
      _inputs.specificTitle.style.borderBottomColor = `color-mix(in srgb, ${baseColor} 20%, white)`;
    }
  }

  function _renderIoTFields(data) {
    const container = _inputs.specificContainer;
    if (!container) return;

    container.innerHTML += _createTextareaHTML('iot_deviceScale', '設備規模', data.iot_deviceScale, '例：機台數量 50 台、PLC 型號...');

    const lineFeaturesVal = (data.iot_lineFeatures || '').split(',').map(s => s.trim());
    container.innerHTML += _createCheckboxGroupHTML('iot_lineFeatures', '生產線特徵(可多選)', DEFAULT_OPTIONS.lineFeatures, lineFeaturesVal);

    container.innerHTML += _createTextareaHTML('iot_productionStatus', '生產現況', data.iot_productionStatus, '請描述客戶目前的生產流程、稼動率或遇到的瓶頸...');
    container.innerHTML += _createTextareaHTML('iot_iotStatus', 'IoT現況', data.iot_iotStatus, '客戶是否已導入 MES、ERP 或其他聯網系統？');

    const painPointsVal = (data.iot_painPoints || '').split(',').map(s => s.trim());
    container.innerHTML += _createCheckboxGroupHTML('iot_painPoints', '痛點分類(可多選)', DEFAULT_OPTIONS.painPoints, painPointsVal);

    container.innerHTML += _createTextareaHTML('iot_painPointDetails', '客戶痛點說明', data.iot_painPointDetails, '請詳細描述客戶提出的具體困難點...');
    container.innerHTML += _createTextareaHTML('iot_painPointAnalysis', '痛點分析與對策', data.iot_painPointAnalysis, '針對上述痛點，我方提出的分析觀點或初步對策...');
    container.innerHTML += _createTextareaHTML('iot_systemArchitecture', '系統架構', data.iot_systemArchitecture, '請描述預計導入的架構、硬體配置或軟體模組...');
  }

  function _renderSimpleFields(data, keys, labels, placeholders = []) {
    let html = '';
    keys.forEach((key, idx) => {
      html += _createInputHTML(key, labels[idx], data[key], placeholders[idx] || '');
    });
    if (_inputs.specificContainer) _inputs.specificContainer.innerHTML = html;
  }

  function _createInputHTML(name, label, value = '', placeholder = '') {
    const safeVal = (value === null || value === undefined) ? '' : String(value);
    return `<div class="form-group"><label class="iso-label">${label}</label><input type="text" class="iso-input" name="${name}" value="${safeVal}" placeholder="${placeholder || ''}"></div>`;
  }

  function _createTextareaHTML(name, label, value = '', placeholder = '') {
    const safeVal = (value === null || value === undefined) ? '' : String(value);
    return `<div class="form-group"><label class="iso-label">${label}</label><textarea class="form-textarea" name="${name}" rows="1" placeholder="${placeholder || ''}">${safeVal}</textarea></div>`;
  }

  function _createCheckboxGroupHTML(name, label, options, selectedValues) {
    let checks = options.map(opt => {
      const checked = selectedValues.includes(opt) ? 'checked' : '';
      return `<label><input type="checkbox" name="${name}" value="${opt}" ${checked}> ${opt}</label>`;
    }).join('');
    return `<div class="form-group"><label class="iso-label">${label}</label><div class="checkbox-group">${checks}</div></div>`;
  }

  function _renderPillSelector(type, container, optionsList, selectedSet) {
    if (!container) return;

    const allItems = new Map();
    (optionsList || []).forEach(opt => {
      const val = opt.value || opt.name || opt.note;
      const label = opt.note || opt.name || val;
      if (val) allItems.set(val, label);
    });

    let html = '';
    allItems.forEach((label, val) => {
      const isSelected = selectedSet.has(val) ? 'selected' : '';
      html += `<span class="participant-pill-tag ${isSelected}" onclick="EventEditorStandalone.toggleItem('${type}', '${val}', this)">${label}</span>`;
    });
    container.innerHTML = html;
  }

  function toggleItem(dataSetKey, val, el) {
    const targetSet = (dataSetKey === 'our') ? _data.ourParticipants : _data.clientParticipants;
    if (targetSet.has(val)) {
      targetSet.delete(val);
      if (el) el.classList.remove('selected');
    } else {
      targetSet.add(val);
      if (el) el.classList.add('selected');
    }
  }

  async function _fetchAndPopulateClientParticipants(oppId, compId, currentList) {
    let contacts = [];
    try {
      if (oppId) {
        const res = await authedFetch(`/api/opportunities/${oppId}/details`);
        if (res && res.success) contacts = res.data.linkedContacts || [];
      } else if (compId) {
        const all = await authedFetch(`/api/companies`).then(r => r?.data || []);
        const comp = all.find(c => c.companyId === compId);
        if (comp) {
          const res = await authedFetch(`/api/companies/${encodeURIComponent(comp.companyName)}/details`);
          if (res && res.success) contacts = res.data.contacts || [];
        }
      }
    } catch (e) {
      console.error('[EventEditorStandalone] fetch contacts failed:', e);
    }

    const manualList = [];
    const knownNames = new Set((contacts || []).map(c => c.name));
    (currentList || []).forEach(p => {
      if (knownNames.has(p)) _data.clientParticipants.add(p);
      else manualList.push(p);
    });

    _renderPillSelector('client', _inputs.clientContainer, contacts, _data.clientParticipants);
    if (_inputs.manualClient) _inputs.manualClient.value = manualList.join(', ');
  }

  function _mergePillsAndInput(set, inputEl) {
    const manuals = (inputEl?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    return [...Array.from(set), ...manuals].join(', ');
  }

  function _appendDynamicSpecificFields(formData) {
    document.querySelectorAll(
      '#standalone-specific-container input[name], #standalone-specific-container textarea[name], #standalone-specific-container select[name]'
    ).forEach(el => {
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked) formData.append(el.name, el.value);
      } else {
        formData.append(el.name, el.value);
      }
    });
  }

  function _buildPayload(formData) {
    const out = {};
    for (let [k, v] of formData.entries()) {
      if (out[k] === undefined) out[k] = v;
      else if (Array.isArray(out[k])) out[k].push(v);
      else out[k] = [out[k], v];
    }
    for (const k of Object.keys(out)) {
      if (Array.isArray(out[k])) out[k] = out[k].join(', ');
    }
    return out;
  }

  async function _handleSubmit(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    // ✅ submitting guard
    if (_isSubmitting) return;
    _isSubmitting = true;

    console.log('[EventEditorStandalone] _handleSubmit triggered');

    try {
      if (!_form) {
        showNotification('儲存失敗：找不到表單', 'error');
        return;
      }

      const id = _inputs.id?.value;
      if (!id) {
        showNotification('儲存失敗：缺少事件 ID', 'error');
        return;
      }

      _setLoading(true, '儲存中...');

      const formData = new FormData(_form);
      _appendDynamicSpecificFields(formData);

      const data = _buildPayload(formData);
      data.ourParticipants = _mergePillsAndInput(_data.ourParticipants, _inputs.manualOur);
      data.clientParticipants = _mergePillsAndInput(_data.clientParticipants, _inputs.manualClient);

      if (_inputs.time?.value) data.createdTime = new Date(_inputs.time.value).toISOString();

      const res = await authedFetch(`/api/events/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });

      // ✅ Critical change:
      // authedFetch may return undefined for 204/empty-body success.
      // Only treat as failure when res.success === false explicitly.
      if (res && res.success === false) {
        throw new Error(res.error || 'Unknown Error');
      }

      _close();
      try { showNotification('更新成功！', 'success'); } catch (_) {}

      if (window.CRM_APP && typeof window.CRM_APP.refreshCurrentView === 'function') {
        window.CRM_APP.refreshCurrentView('更新成功！');
      }

      const currentHash = (window.location.hash || '').toLowerCase();
      if (currentHash.startsWith('#event-editor')) {
        setTimeout(() => { window.location.hash = '#events'; }, 0);
      }

    } catch (err) {
      console.error('[EventEditorStandalone] save failed:', err);
      showNotification('儲存失敗: ' + (err?.message || err), 'error');
    } finally {
      _setLoading(false);
      _isSubmitting = false;
    }
  }

  function _confirmDelete(id, name) {
    showConfirmDialog(`確定刪除事件 "${name}"？`, async () => {
      showLoading('刪除中...');
      try {
        await authedFetch(`/api/events/${id}`, { method: 'DELETE' });
        _close();
        closeModal('event-log-report-modal');
      } catch (e) {
        console.error('[EventEditorStandalone] delete failed:', e);
      } finally {
        hideLoading();
      }
    });
  }

  function _close() {
    if (_modal) _modal.style.display = 'none';
    if (_resizeObserver) _resizeObserver.disconnect();
    _unlockScroll();
  }

  return {
    open,
    selectType,
    toggleItem
  };
})();

window.EventEditorStandalone = EventEditorStandalone;

if (window.CRM_APP) {
  window.CRM_APP.pageModules['event-editor'] = async (params) => {
    let id = null;
    if (params && typeof params === 'object') id = params.eventId;
    else if (typeof params === 'string') id = params;
    await EventEditorStandalone.open(id);
  };
}
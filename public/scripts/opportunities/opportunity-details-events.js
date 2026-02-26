/**
 * Project: TFC CRM
 * File: public/scripts/opportunities/opportunity-details-events.js
 * Version: 8.0.13
 * Date: 2026-02-26
 * Changelog:
 *  - Phase 8 Opportunity UI: prevent unintended field wiping on save
 *  - If an edit DOM field is missing/unset, DO NOT overwrite existing data with empty string
 */

// public/scripts/opportunity-details-events.js
// 職責：處理「機會資訊卡」的使用者互動事件 (編輯切換、資料驗證、儲存)
// (V-Layout: 包含建立日期儲存)

const OpportunityInfoCardEvents = (() => {
    let _currentOppForEditing = null;
    let _specQuantities = new Map();

    function init(opportunityData) {
        _currentOppForEditing = opportunityData;
        _initSpecQuantities();
    }

    function _initSpecQuantities() {
        _specQuantities.clear();
        if (!_currentOppForEditing) return;
        try {
            const parsed = JSON.parse(_currentOppForEditing.potentialSpecification);
            if (parsed && typeof parsed === 'object') {
                _specQuantities = new Map(Object.entries(parsed));
            }
        } catch (e) {
            if (_currentOppForEditing.potentialSpecification) {
                _currentOppForEditing.potentialSpecification.split(',').forEach(s => _specQuantities.set(s.trim(), 1));
            }
        }
    }

    function toggleEditMode(isEditing) {
        const displayMode = document.getElementById('opportunity-info-display-mode');
        const editMode = document.getElementById('opportunity-info-edit-mode');
        if (!displayMode || !editMode) return;

        if (isEditing) {
            if (!_currentOppForEditing) return showNotification('資料未就緒', 'error');
            displayMode.style.display = 'none';
            editMode.style.display = 'block';
            _bindSpecEvents();
            _initSpecQuantities();

            if (_currentOppForEditing.customerCompany) {
                handleCustomerChange(_currentOppForEditing.customerCompany, _currentOppForEditing.mainContact);
            }
            if (_currentOppForEditing.salesModel !== '直接販售' && _currentOppForEditing.channelDetails) {
                handleChannelChange(_currentOppForEditing.channelDetails, _currentOppForEditing.channelContact);
            }
        } else {
            editMode.style.display = 'none';
            displayMode.style.display = 'block';
        }
    }

    function handleSingleSelectClick(element) {
        const container = element.closest('.single-select-container');
        const targetId = element.dataset.fieldTarget;
        const value = element.dataset.value;

        container.querySelectorAll('.info-option-pill').forEach(pill => pill.classList.remove('selected'));
        element.classList.add('selected');

        const hiddenInput = document.getElementById('edit-' + targetId);
        if (hiddenInput) hiddenInput.value = value;
    }

    async function handleSalesModelPillClick(element) {
        handleSingleSelectClick(element);
        const value = element.dataset.value;
        await OpportunityInfoCard.handleSalesModelChange(value, true);
    }

    async function _getCompanyContacts(companyName) {
        if (!companyName) return [];
        try {
            const res = await authedFetch(`/api/companies/${encodeURIComponent(companyName)}/details`);
            if (res.success && res.data && Array.isArray(res.data.contacts)) {
                return res.data.contacts;
            }
        } catch (e) {
            console.error(`無法取得 ${companyName} 的聯絡人:`, e);
        }
        return [];
    }

    function _generateContactOptions(contacts, defaultContact) {
        let html = '<option value="">-- 請選擇 --</option>';
        if (contacts.length === 0) {
            html += '<option value="" disabled>無已建檔聯絡人</option>';
        } else {
            contacts.forEach(c => {
                const label = c.position ? `${c.name} (${c.position})` : c.name;
                const isSelected = defaultContact === c.name;
                html += `<option value="${c.name}" ${isSelected ? 'selected' : ''}>${label}</option>`;
            });
        }
        if (defaultContact && !contacts.some(c => c.name === defaultContact)) {
            html += `<option value="${defaultContact}" selected>${defaultContact} (未知/自填)</option>`;
        }
        return html;
    }

    async function handleCustomerChange(customerName, defaultContact = null) {
        const contactSelect = document.getElementById('edit-main-contact');
        if (!contactSelect) return;

        contactSelect.innerHTML = '<option value="">載入中...</option>';
        contactSelect.disabled = true;

        const contacts = await _getCompanyContacts(customerName);

        contactSelect.innerHTML = _generateContactOptions(contacts, defaultContact);
        contactSelect.disabled = false;

        const salesModelInput = document.getElementById('edit-sales-model');
        const channelSelect = document.getElementById('edit-channel-details');

        if (salesModelInput && salesModelInput.value === '直接販售' && channelSelect) {
            channelSelect.innerHTML = `<option value="${customerName}" selected>${customerName} (直販)</option>`;
            channelSelect.disabled = true;

            const channelContactSelect = document.getElementById('edit-channel-contact');
            if (channelContactSelect) {
                channelContactSelect.innerHTML = '<option value="">-- 不適用 --</option>';
                channelContactSelect.disabled = true;
            }
        }
    }

    async function handleChannelChange(companyName, defaultContact = null) {
        const contactSelect = document.getElementById('edit-channel-contact');
        if (!contactSelect) return;

        if (!companyName) {
            contactSelect.innerHTML = '<option value="">-- 請先選擇通路公司 --</option>';
            contactSelect.disabled = true;
            return;
        }

        contactSelect.innerHTML = '<option value="">載入中...</option>';
        contactSelect.disabled = true;

        const contacts = await _getCompanyContacts(companyName);

        contactSelect.innerHTML = _generateContactOptions(contacts, defaultContact);
        contactSelect.disabled = false;
    }

    function handleManualOverride(checkbox) {
        const input = document.getElementById('edit-opportunity-value');
        if (!input) return;
        if (checkbox.checked) {
            input.disabled = false;
        } else {
            input.disabled = true;
            _calculateTotalValue();
        }
    }

    function _bindSpecEvents() {
        const container = document.getElementById('spec-pills-container');
        if (!container) return;

        container.onclick = null;

        container.onclick = (e) => {
            const pill = e.target.closest('.info-option-pill');
            const qtySpan = e.target.closest('.pill-quantity');

            if (qtySpan) {
                e.stopPropagation();
                _handleQuantityChange(qtySpan);
            } else if (pill) {
                _handleSpecAccumulate(pill);
            }
        };
    }

    function _handleSpecAccumulate(pill) {
        const specId = pill.dataset.specId;
        const systemConfig = (window.CRM_APP && window.CRM_APP.systemConfig && window.CRM_APP.systemConfig['可能下單規格']) || [];
        const config = systemConfig.find(s => s.value === specId);
        const allowQuantity = config && config.value3 === 'allow_quantity';

        if (_specQuantities.has(specId)) {
            if (allowQuantity) {
                const current = _specQuantities.get(specId);
                _specQuantities.set(specId, current + 1);
                _updatePillUI(pill, current + 1);
            } else {
                _specQuantities.delete(specId);
                pill.classList.remove('selected');
            }
        } else {
            _specQuantities.set(specId, 1);
            pill.classList.add('selected');
            if (allowQuantity) _addQuantityBadge(pill, 1, specId);
        }
        _calculateTotalValue();
    }

    function _handleQuantityChange(span) {
        const specId = span.dataset.specId;
        const current = _specQuantities.get(specId) || 1;
        const input = prompt('請輸入數量 (輸入 0 可移除):', current);
        if (input !== null) {
            const num = parseInt(input);
            const pill = span.closest('.info-option-pill');
            if (!isNaN(num) && num > 0) {
                _specQuantities.set(specId, num);
                span.innerText = `(x${num})`;
            } else {
                _specQuantities.delete(specId);
                pill.classList.remove('selected');
                span.remove();
            }
            _calculateTotalValue();
        }
    }

    function _addQuantityBadge(pill, qty, specId) {
        let span = pill.querySelector('.pill-quantity');
        if (!span) {
            span = document.createElement('span');
            span.className = 'pill-quantity';
            span.dataset.specId = specId;
            pill.appendChild(span);
        }
        span.innerText = `(x${qty})`;
    }

    function _updatePillUI(pill, qty) {
        let span = pill.querySelector('.pill-quantity');
        if (span) span.innerText = `(x${qty})`;
    }

    function _calculateTotalValue() {
        const manualCheck = document.getElementById('value-manual-override-checkbox');
        if (manualCheck && manualCheck.checked) return;

        const input = document.getElementById('edit-opportunity-value');
        if (!input) return;

        const systemConfig = (window.CRM_APP && window.CRM_APP.systemConfig && window.CRM_APP.systemConfig['可能下單規格']) || [];
        let total = 0;
        _specQuantities.forEach((qty, specId) => {
            const config = systemConfig.find(s => s.value === specId);
            if (config && config.value2) total += (parseFloat(config.value2) || 0) * qty;
        });

        // NOTE: keep raw number (no commas) if your backend expects numeric string
        input.value = String(Math.round(total));
    }

    // ======= 핵심修補：避免「沒改的欄位」被空字串覆蓋 =======
    async function save() {
        if (!_currentOppForEditing) return;

        // Return undefined if element doesn't exist (do NOT return '')
        const getValueMaybe = (id) => {
            const el = document.getElementById(id);
            if (!el) return undefined;
            const v = (el.value ?? '').toString().trim();
            return v;
        };

        const oppName = getValueMaybe('edit-opportunity-name');
        const finalOppName = (oppName !== undefined) ? oppName : (_currentOppForEditing.opportunityName || '');
        if (!finalOppName) return showNotification('機會名稱必填', 'error');

        const specData = {};
        _specQuantities.forEach((v, k) => specData[k] = v);

        const manualEl = document.getElementById('value-manual-override-checkbox');
        const isManual = manualEl ? !!manualEl.checked : ((_currentOppForEditing.opportunityValueType || _currentOppForEditing.valueCalcMode) === 'manual');

        const salesModel = getValueMaybe('edit-sales-model');
        const finalSalesModel = (salesModel !== undefined) ? salesModel : (_currentOppForEditing.salesModel || '');

        let channelDetails = getValueMaybe('edit-channel-details');
        let channelContact = getValueMaybe('edit-channel-contact');

        // If direct sale, channelDetails should follow customerCompany
        const customerCompany = getValueMaybe('edit-customer-company');
        const finalCustomerCompany = (customerCompany !== undefined) ? customerCompany : (_currentOppForEditing.customerCompany || '');

        if (finalSalesModel === '直接販售') {
            channelDetails = finalCustomerCompany;
            channelContact = '';
        }

        // For each field: if DOM missing -> keep existing value
        const pick = (maybe, existingKeys, fallback = '') => {
            if (maybe !== undefined) return maybe;
            for (const k of existingKeys) {
                const v = _currentOppForEditing[k];
                if (v !== undefined && v !== null) return (typeof v === 'string') ? v : String(v);
            }
            return fallback;
        };

        const finalChannelDetails = pick(channelDetails, ['channelDetails', 'salesChannel'], '');
        const finalMainContact = pick(getValueMaybe('edit-main-contact'), ['mainContact'], '');
        const finalChannelContact = pick(channelContact, ['channelContact'], '');

        const finalExpectedCloseDate = pick(getValueMaybe('edit-expected-close-date'), ['expectedCloseDate'], '');
        const finalCreatedTime = pick(getValueMaybe('edit-created-time'), ['createdTime'], '');

        // These are the legacy keys your frontend uses; backend may map them
        const finalAssignee = pick(getValueMaybe('edit-assignee'), ['assignee', 'owner'], '');
        const finalOppSource = pick(getValueMaybe('edit-opportunity-source'), ['opportunitySource', 'source'], '');
        const finalOppType = pick(getValueMaybe('edit-opportunity-type'), ['opportunityType'], '');
        const finalStage = pick(getValueMaybe('edit-current-stage'), ['currentStage'], '');
        const finalProb = pick(getValueMaybe('edit-order-probability'), ['orderProbability', 'winProbability'], '');
        const finalSalesChannel = pick(getValueMaybe('edit-sales-channel'), ['salesChannel'], '');
        const finalDeviceScale = pick(getValueMaybe('edit-device-scale'), ['deviceScale', 'equipmentScale'], '');
        const finalNotes = pick(getValueMaybe('edit-notes'), ['notes'], '');

        // Value
        const rawValMaybe = getValueMaybe('edit-opportunity-value');
        const finalValue = (rawValMaybe !== undefined)
            ? (rawValMaybe.replace(/,/g, '') || '0')
            : (String(_currentOppForEditing.opportunityValue ?? '0').replace(/,/g, '') || '0');

        const updateData = {
            opportunityName: finalOppName,
            customerCompany: finalCustomerCompany,
            channelDetails: finalChannelDetails,
            mainContact: finalMainContact,
            channelContact: finalChannelContact,
            expectedCloseDate: finalExpectedCloseDate,

            // Created date
            createdTime: finalCreatedTime,

            salesModel: finalSalesModel,

            // Legacy UI keys (compatible with current frontend)
            assignee: finalAssignee,
            opportunitySource: finalOppSource,
            opportunityType: finalOppType,
            currentStage: finalStage,
            orderProbability: finalProb,
            salesChannel: finalSalesChannel,
            deviceScale: finalDeviceScale,

            opportunityValue: finalValue,
            opportunityValueType: isManual ? 'manual' : 'auto',
            potentialSpecification: JSON.stringify(specData),

            // Keep as-is if you don't use drive link in UI yet
            driveFolderLink: pick(undefined, ['driveFolderLink', 'driveLink'], ''),

            notes: finalNotes
        };

        showLoading('正在儲存...');
        try {
            const result = await authedFetch(`/api/opportunities/${_currentOppForEditing.opportunityId}`, {
                method: 'PUT',
                // IMPORTANT: avoid authedFetch "smart refresh" interfering; we handle UI ourselves
                skipRefresh: true,
                body: JSON.stringify({ ...updateData, modifier: getCurrentUser() })
            });

            if (result && result.success) {
                showNotification('儲存成功', 'success');

                // Update local state without wiping
                const updatedOpp = { ..._currentOppForEditing, ...updateData };
                _currentOppForEditing = updatedOpp;
                window.currentOpportunityData = updatedOpp;

                // Re-render info card (display wrappers + view)
                if (typeof OpportunityInfoCard !== 'undefined' && typeof OpportunityInfoCard.render === 'function') {
                    OpportunityInfoCard.render(updatedOpp);
                }

                // Re-init state
                init(updatedOpp);

                toggleEditMode(false);
            } else {
                throw new Error((result && result.error) || '儲存失敗');
            }
        } catch (e) {
            showNotification(e.message, 'error');
        } finally {
            hideLoading();
        }
    }

    return {
        init,
        toggleEditMode,
        save,
        handleSingleSelectClick,
        handleSalesModelPillClick,
        handleCustomerChange,
        handleChannelChange,
        handleManualOverride
    };
})();
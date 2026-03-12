/**
 * services/company-service.js
 * 公司業務邏輯層
 * @version 8.3.0 (Phase 9.3 Patch - Semantic Data World Isolation)
 * @date 2026-03-12
 * @changelog 
 * - [PHASE 9.3] Fixed semantic mismatch: routed RAW potential contacts fetch explicitly to contactService.getPotentialContacts instead of ambiguously overloading contactReader.getContacts.
 * - [PHASE 9.3] Replaced fallback contactReader.getContactList() with robust contactSqlReader fallback.
 * - Phase 8.2.0: Removed InteractionReader dependency.
 */

class CompanyService {
    constructor(
        companyReader, companyWriter, contactReader, contactWriter,
        opportunityReader, opportunityWriter, interactionReader, interactionWriter,
        eventLogReader, systemReader, companySqlReader, contactService,
        companySqlWriter, // Inject SQL Writer (Phase 7 Requirement)
        eventLogSqlReader, // Inject SQL Reader (Phase 8 Requirement)
        contactSqlReader,       // [Phase 8.1 Requirement]
        opportunitySqlReader,   // [Phase 8.1 Requirement]
        interactionSqlReader    // [Phase 8.1 Requirement]
    ) {
        this.companyReader = companyReader;
        this.companyWriter = companyWriter;
        this.contactReader = contactReader;
        this.contactWriter = contactWriter;
        this.opportunityReader = opportunityReader;
        this.opportunityWriter = opportunityWriter;
        this.interactionReader = interactionReader;
        this.interactionWriter = interactionWriter;
        this.eventLogReader = eventLogReader;
        this.systemReader = systemReader;
        this.companySqlReader = companySqlReader;
        this.contactService = contactService; // Enabler for RAW logic routing
        this.companySqlWriter = companySqlWriter; 
        this.eventLogSqlReader = eventLogSqlReader; 
        
        // [Phase 8.1] New SQL Readers for fast detail lookup
        this.contactSqlReader = contactSqlReader;
        this.opportunitySqlReader = opportunitySqlReader;
        this.interactionSqlReader = interactionSqlReader;
    }

    // --- DTO Mapping (SQL-ready) ---

    _toServiceDTO(raw) {
        if (!raw) return null;

        return {
            companyId: raw.companyId || raw.company_id || '',
            companyName: raw.companyName || raw.company_name || '',
            phone: raw.phone || '',
            address: raw.address || '',
            county: raw.county || raw.city || '', 
            introduction: raw.introduction || raw.description || '', 
            companyType: raw.companyType || raw.company_type || '',
            customerStage: raw.customerStage || raw.customer_stage || '',
            engagementRating: raw.engagementRating || raw.interactionRating || '', 
            createdTime: raw.createdTime || raw.created_time || '',
            lastUpdateTime: raw.lastUpdateTime || raw.updatedTime || raw.updated_time || '',
            creator: raw.creator || raw.createdBy || raw.created_by || '',
            lastModifier: raw.lastModifier || raw.updatedBy || raw.updated_by || '',
            rowIndex: raw.rowIndex
        };
    }

    async _getAllCompanies() {
        let companies = null;

        if (this.companySqlReader) {
            try {
                const sqlRaw = await this.companySqlReader.getCompanies();
                if (sqlRaw && Array.isArray(sqlRaw) && sqlRaw.length > 0) {
                    companies = sqlRaw.map(item => this._toServiceDTO(item));
                }
            } catch (error) {
                console.warn(`[CompanyService] SQL Read Failed, falling back: ${error.message}`);
            }
        }

        if (!companies) {
            try {
                // Safeguard: use SQL Reader if Legacy Reader is missing from Container
                const sheetRaw = this.companyReader ? await this.companyReader.getCompanyList() : await this.companySqlReader.getCompanies();
                companies = sheetRaw.map(item => this._toServiceDTO(item));
            } catch (sheetError) {
                console.error('[CompanyService] Sheet Read Failed:', sheetError);
                throw sheetError;
            }
        }

        return companies;
    }

    async _getCompanyById(companyId) {
        if (!companyId) return null;
        const companies = await this._getAllCompanies();
        return companies.find(c => c.companyId === companyId) || null;
    }

    async _getCompanyByName(companyName) {
        if (!companyName) return null;
        
        const companies = await this._getAllCompanies();
        const normalizedTarget = this._normalizeCompanyName(companyName);
        
        return companies.find(c => 
            this._normalizeCompanyName(c.companyName) === normalizedTarget
        ) || null;
    }

    _normalizeCompanyName(name) {
        if (!name) return '';
        return name.toLowerCase().trim()
            .replace(/股份有限公司|有限公司|公司/g, '')
            .replace(/\(.*\)/g, '')
            .trim();
    }

    async _logCompanyInteraction(companyId, title, summary, modifier) {
        try {
            if (this.interactionWriter && typeof this.interactionWriter.createInteraction === 'function') {
                await this.interactionWriter.createInteraction({
                    companyId: companyId,
                    eventType: '系統事件',
                    eventTitle: title,
                    contentSummary: summary,
                    recorder: modifier,
                    interactionTime: new Date().toISOString()
                }, modifier);
            }
        } catch (logError) {
            console.warn(`[CompanyService] Log Interaction Error: ${logError.message}`);
        }
    }

    async createCompany(companyName, companyData, user) {
        try {
            const modifier = user.displayName || user.username || user || 'System';
            
            const existing = await this._getCompanyByName(companyName);
            if (existing) {
                return { 
                    success: true, 
                    id: existing.companyId, 
                    companyId: existing.companyId, 
                    companyName: existing.companyName, 
                    message: '公司已存在', 
                    existed: true,
                    data: existing
                };
            }

            const companyId = `COMP_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

            const dataToWrite = { 
                companyId: companyId,
                companyName: companyName, 
                ...companyData 
            };
            
            if (!this.companySqlWriter) throw new Error('CompanySqlWriter not injected');
            
            const result = await this.companySqlWriter.createCompany(dataToWrite, modifier);
            
            if (this.companyReader && this.companyReader.invalidateCache) {
                this.companyReader.invalidateCache('companyList');
            }
            
            return {
                ...result,
                companyId: companyId,
                companyName: companyName
            };
        } catch (error) {
            console.error('[CompanyService] Create Error:', error);
            throw error;
        }
    }

    async getCompanyListWithActivity(filters = {}) {
        try {
            let companies = await this._getAllCompanies();

            if (filters.q) {
                const q = filters.q.toLowerCase().trim();
                companies = companies.filter(c => 
                    (c.companyName || '').toLowerCase().includes(q) ||
                    (c.phone || '').includes(q) ||
                    (c.address || '').toLowerCase().includes(q) ||
                    (c.county || '').toLowerCase().includes(q) ||
                    (c.introduction || '').toLowerCase().includes(q)
                );
            }

            if (filters.type && filters.type !== 'all') {
                companies = companies.filter(c => c.companyType === filters.type);
            }
            if (filters.stage && filters.stage !== 'all') {
                companies = companies.filter(c => c.customerStage === filters.stage);
            }
            if (filters.rating && filters.rating !== 'all') {
                companies = companies.filter(c => c.engagementRating === filters.rating);
            }

            const [interactions, eventLogs] = await Promise.all([
                this.interactionSqlReader.getInteractions(),
                this.eventLogSqlReader ? this.eventLogSqlReader.getEventLogs() : this.eventLogReader.getEventLogs()
            ]);

            const lastActivityMap = new Map();
            
            const updateActivity = (companyId, dateStr) => {
                if (!companyId || !dateStr) return;
                const ts = new Date(dateStr).getTime();
                if (isNaN(ts)) return;
                const current = lastActivityMap.get(companyId) || 0;
                if (ts > current) lastActivityMap.set(companyId, ts);
            };

            interactions.forEach(item => updateActivity(item.companyId, item.interactionTime || item.date));
            eventLogs.forEach(item => updateActivity(item.companyId, item.createdTime));

            const result = companies.map(comp => {
                let lastTs = lastActivityMap.get(comp.companyId);
                
                if (!lastTs && comp.createdTime) {
                    const createdTs = new Date(comp.createdTime).getTime();
                    if (!isNaN(createdTs)) lastTs = createdTs;
                }

                return {
                    ...comp,
                    lastActivity: lastTs ? new Date(lastTs).toISOString() : null,
                    _sortTs: lastTs || 0
                };
            });

            result.sort((a, b) => b._sortTs - a._sortTs);
            return result.map(({ _sortTs, ...rest }) => rest);

        } catch (error) {
            console.error('[CompanyService] List Error:', error);
            try {
                const sheetRaw = this.companyReader ? await this.companyReader.getCompanyList() : await this.companySqlReader.getCompanies();
                return sheetRaw.map(item => this._toServiceDTO(item));
            } catch (fallbackError) {
                return [];
            }
        }
    }

    async getCompanyDetails(companyId) {
        try {
            const companyInfo = await this._getCompanyById(companyId);

            if (!companyInfo) {
                return { 
                    companyInfo: null, 
                    contacts: [], 
                    opportunities: [], 
                    potentialContacts: [],
                    interactions: [], 
                    eventLogs: [] 
                };
            }

            const companyName = companyInfo.companyName;
            const normalizedTarget = this._normalizeCompanyName(companyName);

            let sqlSuccess = false;
            let contacts = [], opportunities = [], interactions = [], eventLogs = [], potentialContacts = [];

            if (this.contactSqlReader && this.opportunitySqlReader && this.interactionSqlReader && this.eventLogSqlReader) {
                try {
                    const baseNormalized = companyName.replace(/股份有限公司|有限公司|公司/g, '').replace(/\(.*\)/g, '').trim();

                    const [sqlContacts, sqlOppsRaw, sqlInteractionsComp, sqlEventLogs, allPotentialContacts] = await Promise.all([
                        this.contactSqlReader.getContactsByCompanyId(companyId),
                        this.opportunitySqlReader.getOpportunitiesByCompanyName(baseNormalized),
                        this.interactionSqlReader.getInteractionsByCompanyId(companyId),
                        this.eventLogSqlReader.getEventLogs(), 
                        this.contactService.getPotentialContacts(3000) // [PHASE 9.3] Semantic Fix: Explicitly explicitly route to RAW reader logic
                    ]);

                    opportunities = sqlOppsRaw.filter(o => 
                        this._normalizeCompanyName(o.customerCompany) === normalizedTarget
                    );
                    const relatedOppIds = new Set(opportunities.map(o => o.opportunityId));
                    const oppIdsArray = Array.from(relatedOppIds);
                    
                    const sqlInteractionsOpps = await this.interactionSqlReader.getInteractionsByOpportunityIds(oppIdsArray);

                    const interactionMap = new Map();
                    sqlInteractionsComp.forEach(i => interactionMap.set(i.interactionId, i));
                    sqlInteractionsOpps.forEach(i => interactionMap.set(i.interactionId, i));
                    interactions = Array.from(interactionMap.values())
                        .sort((a, b) => new Date(b.interactionTime || 0) - new Date(a.interactionTime || 0));

                    eventLogs = sqlEventLogs.filter(e => 
                        e.companyId === companyId
                    ).sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));

                    contacts = sqlContacts;
                    
                    potentialContacts = allPotentialContacts.filter(pc => 
                        this._normalizeCompanyName(pc.company) === normalizedTarget
                    );

                    sqlSuccess = true;
                } catch (sqlError) {
                    console.warn(`[CompanyService] SQL-first execution failed, triggering fallback: ${sqlError.message}`);
                    sqlSuccess = false;
                }
            }

            if (!sqlSuccess) {
                const [allContacts, allOpportunities, allInteractions, allEventLogs, allPotentialContacts] = await Promise.all([
                    this.contactSqlReader ? this.contactSqlReader.getContacts() : this.contactReader.getContactList(), // Safe generic extraction
                    this.opportunitySqlReader ? this.opportunitySqlReader.getOpportunities() : this.opportunityReader.getOpportunities(),
                    this.interactionSqlReader.getInteractions(),
                    this.eventLogSqlReader ? this.eventLogSqlReader.getEventLogs() : this.eventLogReader.getEventLogs(), 
                    this.contactService.getPotentialContacts(3000) // [PHASE 9.3] Semantic Fix
                ]);

                contacts = allContacts.filter(c => c.companyId === companyId);
                
                opportunities = allOpportunities.filter(o => 
                    this._normalizeCompanyName(o.customerCompany) === normalizedTarget
                );
                const relatedOppIds = new Set(opportunities.map(o => o.opportunityId));
                
                interactions = allInteractions.filter(i => 
                    i.companyId === companyId || (i.opportunityId && relatedOppIds.has(i.opportunityId))
                ).sort((a, b) => new Date(b.interactionTime || 0) - new Date(a.interactionTime || 0));

                eventLogs = allEventLogs.filter(e => 
                    e.companyId === companyId
                ).sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));

                potentialContacts = allPotentialContacts.filter(pc => 
                    this._normalizeCompanyName(pc.company) === normalizedTarget
                );
            }

            return { companyInfo, contacts, opportunities, potentialContacts, interactions, eventLogs };

        } catch (error) {
            console.error(`[CompanyService] Details Error (${companyId}):`, error);
            throw error;
        }
    }

    async updateCompany(companyId, updateData, user) {
        try {
            const modifier = user.displayName || user.username || 'System';
            
            const companyInfo = await this._getCompanyById(companyId);
            if (!companyInfo) throw new Error(`找不到公司 ID: ${companyId}`);

            const result = await this.companySqlWriter.updateCompany(companyInfo.companyId, updateData, modifier);
            
            await this._logCompanyInteraction(companyInfo.companyId, '資料更新', `公司資料已更新。`, modifier);
            
            if (this.companyReader && this.companyReader.invalidateCache) {
                this.companyReader.invalidateCache('companyList');
            }

            return result;
        } catch (error) {
            console.error('[CompanyService] Update Error:', error);
            throw error;
        }
    }

    async deleteCompany(companyId, user) {
        try {
            const companyInfo = await this._getCompanyById(companyId);
            if (!companyInfo) throw new Error(`找不到公司 ID: ${companyId}`);

            const companyName = companyInfo.companyName;
            
            // Safe fallback
            const opps = this.opportunitySqlReader ? await this.opportunitySqlReader.getOpportunities() : await this.opportunityReader.getOpportunities();
            const relatedOpps = opps.filter(o => 
                this._normalizeCompanyName(o.customerCompany) === this._normalizeCompanyName(companyName)
            );
            
            if (relatedOpps.length > 0) {
                throw new Error(`無法刪除：尚有 ${relatedOpps.length} 個關聯機會案件 (例如: ${relatedOpps[0].opportunityName})。請先移除關聯案件。`);
            }

            const result = await this.companySqlWriter.deleteCompany(companyInfo.companyId);
            
            if (this.companyReader && this.companyReader.invalidateCache) {
                this.companyReader.invalidateCache('companyList');
            }

            return result;
        } catch (error) {
            console.error('[CompanyService] Delete Error:', error);
            throw error;
        }
    }
}

module.exports = CompanyService;
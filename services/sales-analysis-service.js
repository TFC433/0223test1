/**
 * services/sales-analysis-service.js
 * 銷售分析服務
 * * @version 5.1.0 (Phase 1 Safe Alignment)
 * @date 2026-04-21
 * @description 負責處理成交金額、銷售渠道分析與產品組合統計。
 * 依賴注入：OpportunityReader, SystemService, Config
 * @changelog
 * - [2026-04-21] Phase 1 Safe Alignment: Added Overview KPIs, Unique Customer KPIs, and ensured wonDeals dataset matches frontend expectations without modifying frontend behavior.
 * - [2026-03-12] Migrated getSystemConfig from deprecated SystemReader to SystemService.
 */

class SalesAnalysisService {
    /**
     * @param {OpportunityReader} opportunityReader
     * @param {SystemService} systemService
     * @param {Object} config - 系統設定
     */
    constructor(opportunityReader, systemService, config) {
        this.opportunityReader = opportunityReader;
        this.systemService = systemService; 
        this.config = config;
        
        // --- !!! 重要設定 !!! ---
        this.WON_STAGE_VALUE = '受注'; 
    }

    /**
     * 獲取指定時間範圍內的成交分析數據
     * @param {string} startDateISO - 開始日期 (ISO 格式字串)
     * @param {string} endDateISO - 結束日期 (ISO 格式字串)
     * @returns {Promise<object>} - 包含分析結果的物件
     */
    async getSalesAnalysisData(startDateISO, endDateISO) {
        console.log(`📈 [SalesAnalysisService] 計算成交分析資料...`);

        const allOpportunities = await this.opportunityReader.getOpportunities();
        const systemConfig = await this.systemService.getSystemConfig();

        // 1. 準備設定資料傳給前端
        // (A) 銷售模式顏色對應表
        const salesModelColors = {};
        if (systemConfig['銷售模式']) {
            systemConfig['銷售模式'].forEach(item => {
                if (item.color) salesModelColors[item.value] = item.color;
            });
        }

        const start = startDateISO ? new Date(startDateISO) : new Date(0); // 預設很久以前
        const end = endDateISO ? new Date(endDateISO) : new Date(); // 預設現在

        // 2. 篩選「受注」且「在時間範圍內」的案件
        const wonDeals = allOpportunities.filter(opp => {
            // 階段必須是受注
            if (opp.currentStage !== this.WON_STAGE_VALUE) return false;
            
            // 判斷日期 (使用預計結案日或最後更新日)
            const dateStr = opp.expectedCloseDate || opp.lastUpdateTime;
            if (!dateStr) return false;
            
            const dealDate = new Date(dateStr);
            return dealDate >= start && dealDate <= end;
        });

        // 3. 資料正規化 (處理金額與前置時間戳)
        const processedDeals = wonDeals.map(deal => {
            let value = 0;
            // 嘗試解析金額，移除逗號等符號
            if (deal.opportunityValue) {
                value = parseFloat(String(deal.opportunityValue).replace(/,/g, '')) || 0;
            }
            
            return {
                ...deal,
                numericValue: value,
                // 提供 wonDate 以完美對齊前端 Helper 與 Table sorting 所需的邏輯
                wonDate: deal.expectedCloseDate || deal.lastUpdateTime
            };
        });

        // 4. 計算 Overview KPI (對齊前端 SalesAnalysisHelper.calculateOverview)
        let totalVal = 0;
        let totalDays = 0;
        let cycleCount = 0;

        processedDeals.forEach(d => {
            totalVal += d.numericValue || 0;
            if (d.createdTime && d.wonDate) {
                const diff = Math.ceil(Math.abs(new Date(d.wonDate) - new Date(d.createdTime)) / 86400000);
                if (!isNaN(diff)) { 
                    totalDays += diff; 
                    cycleCount++; 
                }
            }
        });

        const overview = {
            totalWonValue: totalVal,
            totalWonDeals: processedDeals.length,
            averageDealValue: processedDeals.length ? totalVal / processedDeals.length : 0,
            averageSalesCycleInDays: cycleCount ? Math.round(totalDays / cycleCount) : 0
        };

        // 5. 計算 KPI Cards - 獨立客戶數 (對齊前端 SalesAnalysisHelper.calculateKpis)
        const calcUnique = (keywords) => {
            const unique = new Set();
            processedDeals.forEach(d => {
                const m = (d.salesModel || '').trim();
                // 使用字串 includes 並計算獨立的 customerCompany
                if (keywords.some(kw => m.includes(kw)) && d.customerCompany) {
                    unique.add(d.customerCompany.trim());
                }
            });
            return unique.size;
        };

        const kpis = {
            direct: calcUnique(['直販', '直接販售']),
            si: calcUnique(['SI', '系統整合']),
            mtb: calcUnique(['MTB', '工具機'])
        };

        // 6. 進行各項維度分析與封裝回傳
        return {
            totalAmount: totalVal, 
            dealCount: processedDeals.length,
            
            // [Phase 1 Alignment] 提供與前端數學運算結果一致的物件
            overview,
            kpis,
            
            // 圖表數據
            bySalesModel: this._analyzeByDimension(processedDeals, 'salesModel', salesModelColors),
            byType: this._analyzeByDimension(processedDeals, 'opportunityType'),     // 對齊前端 Type Chart
            bySource: this._analyzeByDimension(processedDeals, 'opportunitySource'), // 對齊前端 Source Chart
            byChannel: this._analyzeChannels(processedDeals),
            byProduct: this._analyzeProducts(processedDeals),
            
            // 原始清單 (供前端表格使用)
            // ★ 修正：取消原有過度簡化的 map()，保留完整欄位（包含 wonDate, assignee, currentStage 等），
            // 確保前端 Helpers 與 Table Component 可以獲得完整的操作欄位而不出錯。
            wonDeals: processedDeals
        };
    }

    // --- 內部輔助分析函式 ---

    _analyzeByDimension(deals, fieldKey, colorMap = {}) {
        const stats = {};
        deals.forEach(deal => {
            const key = deal[fieldKey] || '未分類';
            if (!stats[key]) stats[key] = 0;
            stats[key] += deal.numericValue;
        });

        return Object.entries(stats).map(([name, val]) => ({
            name,
            y: val,
            color: colorMap[name] || undefined
        })).sort((a, b) => b.y - a.y);
    }

    _analyzeChannels(deals) {
        const stats = {};
        deals.forEach(deal => {
            // [Phase 1 Alignment] 只針對聚合邏輯進行通路 fallback，不改變原始欄位
            let channelName = deal.channelDetails || deal.salesChannel;
            if (!channelName || channelName === '無' || channelName === '-') {
                channelName = '直接販售'; 
            }
            if (!stats[channelName]) stats[channelName] = 0;
            stats[channelName] += deal.numericValue;
        });
        return Object.entries(stats).map(([name, val]) => ({ name, y: val })).sort((a, b) => b.y - a.y);
    }

    _analyzeProducts(deals) {
        const productCounts = {};
        deals.forEach(deal => {
            try {
                if (deal.potentialSpecification) {
                    const specs = JSON.parse(deal.potentialSpecification);
                    if (typeof specs === 'object') {
                        Object.entries(specs).forEach(([prodName, qty]) => {
                            const q = parseInt(qty) || 0;
                            if (q > 0) {
                                if (!productCounts[prodName]) productCounts[prodName] = 0;
                                productCounts[prodName] += q;
                            }
                        });
                    }
                }
            } catch (e) {
                if (typeof deal.potentialSpecification === 'string') {
                    const name = deal.potentialSpecification.trim();
                    if (name) {
                        productCounts[name] = (productCounts[name] || 0) + 1;
                    }
                }
            }
        });
        return Object.entries(productCounts).map(([name, count]) => ({ name, y: count })).sort((a, b) => b.y - a.y);
    }
}

module.exports = SalesAnalysisService;
/**
 * services/sales-analysis-service.js
 * 銷售分析服務
 * * @version 6.0.0 (Phase 5-A - Base Dataset SQL Pushdown & Fully Converged SSOT)
 * @date 2026-04-21
 * @description 全面掌管日期、商流過濾與 Dashboard KPI 的聚合計算，並將基礎條件下推至資料層以提昇效能。
 * 依賴注入：OpportunityReader, SystemService, Config
 * @changelog
 * - [2026-04-21] Phase 5-A: Changed to consume getSalesAnalysisBaseDeals() pushing stage filtering to DB layer. Integrated all Phase 4 Fix logic natively.
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
        
        this.WON_STAGE_VALUE = '受注'; 
    }

    /**
     * 獲取分析數據 (SQL-Optimized SSOT Mode)
     */
    async getSalesAnalysisData(startDateISO, endDateISO, salesModelFilter = 'all') {
        console.log(`📈 [SalesAnalysisService] 計算成交分析資料 (SQL-Optimized SSOT Mode)...`);

        // 1. [Phase 5-A] 透過 Reader 向下層請求已套用 stage='受注' 與 Date Range 的基礎資料集
        // 這徹底避免了先將所有資料撈進 Node.js Memory 再慢慢 Filter 的效能浪費
        const baseDeals = await this.opportunityReader.getSalesAnalysisBaseDeals(startDateISO, endDateISO);
        
        const systemConfig = await this.systemService.getSystemConfig();

        const salesModelColors = {};
        if (systemConfig['銷售模式']) {
            systemConfig['銷售模式'].forEach(item => {
                if (item.color) salesModelColors[item.value] = item.color;
            });
        }

        // 2. 資料正規化 (確保數值為可運算格式與保留時間戳)
        const processedDeals = baseDeals.map(deal => {
            let value = 0;
            if (deal.opportunityValue) {
                value = parseFloat(String(deal.opportunityValue).replace(/,/g, '')) || 0;
            }
            return {
                ...deal,
                numericValue: value,
                wonDate: deal.expectedCloseDate || deal.lastUpdateTime
            };
        });

        // 3. 商流過濾 (Backend-Owned Filter)
        // 嚴格相等 (Exact Match) 以吻合前端業務邏輯
        const finalDeals = (salesModelFilter && salesModelFilter !== 'all')
            ? processedDeals.filter(d => d.salesModel === salesModelFilter)
            : processedDeals;

        // 4. 計算 Overview KPI (基於最終過濾結果 finalDeals)
        let totalVal = 0;
        let totalDays = 0;
        let cycleCount = 0;

        finalDeals.forEach(d => {
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
            totalWonDeals: finalDeals.length,
            averageDealValue: finalDeals.length ? totalVal / finalDeals.length : 0,
            averageSalesCycleInDays: cycleCount ? Math.round(totalDays / cycleCount) : 0
        };

        // 5. 計算 KPI Cards (字串 Includes 比對 + 獨立公司數)
        const calcUnique = (keywords) => {
            const unique = new Set();
            finalDeals.forEach(d => {
                const m = (d.salesModel || '').trim();
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
        
        // 從無過濾的總集萃取商流選項供下拉選單使用
        const filterOptions = [...new Set(processedDeals.map(d => d.salesModel).filter(Boolean))].sort();

        return {
            totalAmount: totalVal, 
            dealCount: finalDeals.length,
            overview,
            kpis,
            byType: this._analyzeByDimension(finalDeals, 'opportunityType'),     
            bySource: this._analyzeByDimension(finalDeals, 'opportunitySource'), 
            byChannel: this._analyzeChannels(finalDeals),
            byProduct: this._analyzeProducts(finalDeals),
            
            // finalDeals 供前端當下的 Table List 與 Dashboard 顯示
            wonDeals: finalDeals,
            
            // processedDeals 供下拉選單或業務除錯比對 (CSV依據Phase 4 Fix使用wonDeals)
            allWonDeals: processedDeals,
            
            filterOptions,
            salesModelColors
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
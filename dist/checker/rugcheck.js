"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RugCheckChecker = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const logger_1 = require("../utils/logger");
class RugCheckChecker {
    constructor() {
        this.baseUrl = 'https://api.rugcheck.xyz/v1';
        this.lastRequestTime = 0;
        this.requestDelay = 2000;
    }
    async checkToken(tokenAddress) {
        try {
            logger_1.logger.debug(`RugCheck analysis for token: ${tokenAddress}`);
            const data = await this.makeRequest(`/tokens/${tokenAddress}/report`);
            if (!data) {
                return {
                    score: 0,
                    flags: ['RUGCHECK_API_FAILED'],
                    risks: [],
                    warnings: []
                };
            }
            return this.parseRugCheckResponse(data);
        }
        catch (error) {
            logger_1.logger.error(`RugCheck failed for ${tokenAddress}`, error);
            return {
                score: 0,
                flags: ['RUGCHECK_API_ERROR'],
                risks: ['Failed to connect to RugCheck API'],
                warnings: []
            };
        }
    }
    async makeRequest(endpoint) {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.requestDelay) {
            await new Promise(resolve => setTimeout(resolve, this.requestDelay - timeSinceLastRequest));
        }
        try {
            const url = `${this.baseUrl}${endpoint}`;
            const response = await (0, node_fetch_1.default)(url, {
                headers: {
                    'User-Agent': 'Solana-Memecoin-Bot/1.0',
                    'Accept': 'application/json'
                },
                timeout: 10000
            });
            this.lastRequestTime = Date.now();
            if (!response.ok) {
                if (response.status === 429) {
                    logger_1.logger.warning('RugCheck rate limit hit, waiting...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    return this.makeRequest(endpoint);
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            return data;
        }
        catch (error) {
            logger_1.logger.error('RugCheck API request failed', error);
            throw error;
        }
    }
    parseRugCheckResponse(data) {
        try {
            const flags = [];
            const risks = [];
            const warnings = [];
            let score = 100;
            if (data.rugged) {
                flags.push('RUGCHECK_FLAGGED_AS_RUGGED');
                score = 0;
                risks.push('Token flagged as rugged by RugCheck');
                return { score, flags, risks, warnings };
            }
            if (data.risks && Array.isArray(data.risks)) {
                for (const risk of data.risks) {
                    switch (risk.level) {
                        case 'danger':
                            flags.push(`DANGER_${risk.name.toUpperCase().replace(/\s+/g, '_')}`);
                            risks.push(risk.description);
                            score -= 30;
                            break;
                        case 'warning':
                            flags.push(`WARNING_${risk.name.toUpperCase().replace(/\s+/g, '_')}`);
                            warnings.push(risk.description);
                            score -= 15;
                            break;
                        case 'info':
                            warnings.push(risk.description);
                            score -= 5;
                            break;
                    }
                }
            }
            if (typeof data.score === 'number') {
                score = Math.min(score, data.score);
            }
            if (data.creators_percent > 20) {
                flags.push('HIGH_CREATOR_PERCENTAGE');
                risks.push(`Creators own ${data.creators_percent}% of supply`);
                score -= 25;
            }
            else if (data.creators_percent > 10) {
                flags.push('MODERATE_CREATOR_PERCENTAGE');
                warnings.push(`Creators own ${data.creators_percent}% of supply`);
                score -= 10;
            }
            if (data.markets && data.markets.length > 0) {
                const market = data.markets[0];
                if (market.lp) {
                    const lpLocked = market.lp.lpLockedPct || 0;
                    const lpBurned = market.lp.lpBurnedPct || 0;
                    const totalLpSecured = lpLocked + lpBurned;
                    if (totalLpSecured < 50) {
                        flags.push('INSUFFICIENT_LP_SECURITY');
                        risks.push(`Only ${totalLpSecured}% of LP is locked/burned`);
                        score -= 30;
                    }
                    else if (totalLpSecured < 80) {
                        flags.push('PARTIAL_LP_SECURITY');
                        warnings.push(`${totalLpSecured}% of LP is locked/burned`);
                        score -= 10;
                    }
                }
            }
            if (data.fileMeta) {
                if (!data.fileMeta.name || data.fileMeta.name.trim() === '') {
                    flags.push('NO_TOKEN_NAME');
                    warnings.push('Token has no name in metadata');
                    score -= 5;
                }
                if (!data.fileMeta.symbol || data.fileMeta.symbol.trim() === '') {
                    flags.push('NO_TOKEN_SYMBOL');
                    warnings.push('Token has no symbol in metadata');
                    score -= 5;
                }
                if (!data.fileMeta.description || data.fileMeta.description.trim() === '') {
                    flags.push('NO_TOKEN_DESCRIPTION');
                    warnings.push('Token has no description in metadata');
                    score -= 3;
                }
                if (!data.fileMeta.image || data.fileMeta.image.trim() === '') {
                    flags.push('NO_TOKEN_IMAGE');
                    warnings.push('Token has no image in metadata');
                    score -= 2;
                }
            }
            return {
                score: Math.max(0, score),
                flags,
                risks,
                warnings
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to parse RugCheck response', error);
            return {
                score: 0,
                flags: ['RUGCHECK_PARSE_ERROR'],
                risks: ['Failed to parse RugCheck response'],
                warnings: []
            };
        }
    }
    async checkMultipleTokens(tokenAddresses) {
        const results = new Map();
        logger_1.logger.info(`Checking ${tokenAddresses.length} tokens with RugCheck...`);
        for (let i = 0; i < tokenAddresses.length; i++) {
            const address = tokenAddresses[i];
            try {
                const result = await this.checkToken(address);
                results.set(address, result);
                logger_1.logger.debug(`RugCheck completed for ${address} (${i + 1}/${tokenAddresses.length})`);
                if (i < tokenAddresses.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, this.requestDelay));
                }
            }
            catch (error) {
                logger_1.logger.error(`RugCheck failed for ${address}`, error);
                results.set(address, {
                    score: 0,
                    flags: ['RUGCHECK_FAILED'],
                    risks: ['RugCheck analysis failed'],
                    warnings: []
                });
            }
        }
        return results;
    }
    async getDetailedReport(tokenAddress) {
        try {
            const data = await this.makeRequest(`/tokens/${tokenAddress}/report`);
            return {
                summary: this.parseRugCheckResponse(data),
                metadata: data.fileMeta || {},
                markets: data.markets || [],
                rawData: data
            };
        }
        catch (error) {
            logger_1.logger.error(`Failed to get detailed RugCheck report for ${tokenAddress}`, error);
            return {
                summary: {
                    score: 0,
                    flags: ['DETAILED_REPORT_FAILED'],
                    risks: ['Failed to get detailed report'],
                    warnings: []
                },
                metadata: {},
                markets: [],
                rawData: {}
            };
        }
    }
    async healthCheck() {
        try {
            await this.makeRequest('/health');
            return true;
        }
        catch (error) {
            logger_1.logger.error('RugCheck health check failed', error);
            return false;
        }
    }
    getServiceInfo() {
        return {
            name: 'RugCheck.xyz',
            baseUrl: this.baseUrl,
            requestDelay: this.requestDelay,
            lastRequestTime: this.lastRequestTime
        };
    }
}
exports.RugCheckChecker = RugCheckChecker;

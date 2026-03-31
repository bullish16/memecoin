"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenScanner = void 0;
const dexscreener_1 = require("./dexscreener");
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
class TokenScanner {
    constructor() {
        this.isRunning = false;
        this.seenTokens = new Set();
        this.dexScreener = new dexscreener_1.DexScreenerAPI();
    }
    async start() {
        if (this.isRunning) {
            logger_1.logger.warning('Scanner is already running');
            return;
        }
        this.isRunning = true;
        logger_1.logger.success('Token scanner started');
        await this.performScan();
        this.scanInterval = setInterval(async () => {
            await this.performScan();
        }, config_1.config.scanIntervalMs);
    }
    stop() {
        if (!this.isRunning) {
            return;
        }
        this.isRunning = false;
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = undefined;
        }
        logger_1.logger.info('Token scanner stopped');
    }
    async performScan() {
        try {
            logger_1.logger.scanner('Starting scan for new tokens...');
            const [newPairs, pumpGraduates] = await Promise.all([
                this.dexScreener.getNewPairs(),
                this.dexScreener.getPumpFunGraduates()
            ]);
            const allPairs = [...newPairs, ...pumpGraduates];
            const uniquePairs = this.deduplicatePairs(allPairs);
            const freshTokens = uniquePairs.filter(pair => {
                const tokenAddress = pair.baseToken.address;
                if (this.seenTokens.has(tokenAddress)) {
                    return false;
                }
                this.seenTokens.add(tokenAddress);
                return true;
            });
            if (freshTokens.length > 0) {
                logger_1.logger.scanner(`Found ${freshTokens.length} new tokens to analyze`);
                for (const pair of freshTokens) {
                    this.onNewTokenFound(pair);
                }
            }
            else {
                logger_1.logger.scanner('No new tokens found in this scan');
            }
            return freshTokens;
        }
        catch (error) {
            logger_1.logger.error('Error during token scan', error);
            return [];
        }
    }
    deduplicatePairs(pairs) {
        const seen = new Set();
        return pairs.filter(pair => {
            const tokenAddress = pair.baseToken.address;
            if (seen.has(tokenAddress)) {
                return false;
            }
            seen.add(tokenAddress);
            return true;
        });
    }
    onNewTokenFound(pair) {
        const tokenInfo = {
            address: pair.baseToken.address,
            symbol: pair.baseToken.symbol,
            name: pair.baseToken.name,
            priceUsd: pair.priceUsd,
            liquidity: pair.liquidity?.usd,
            volume24h: pair.volume.h24,
            marketCap: pair.marketCap,
            age: pair.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt * 1000) / 60000) : 'unknown'
        };
        logger_1.logger.scanner(`New token detected: ${pair.baseToken.symbol}`, tokenInfo);
        this.emit('newToken', pair);
    }
    emit(event, data) {
        if (this.onNewTokenCallback) {
            this.onNewTokenCallback(data);
        }
    }
    onNewToken(callback) {
        this.onNewTokenCallback = callback;
    }
    async scanNow() {
        logger_1.logger.info('Performing manual scan...');
        return await this.performScan();
    }
    getStatus() {
        return {
            isRunning: this.isRunning,
            seenTokensCount: this.seenTokens.size,
            lastScanTime: Date.now()
        };
    }
    clearCache() {
        this.seenTokens.clear();
        logger_1.logger.info('Scanner cache cleared');
    }
    async getTokenPrice(tokenAddress) {
        return await this.dexScreener.getTokenPrice(tokenAddress);
    }
    async getTokenInfo(tokenAddress) {
        return await this.dexScreener.getTokenInfo(tokenAddress);
    }
}
exports.TokenScanner = TokenScanner;

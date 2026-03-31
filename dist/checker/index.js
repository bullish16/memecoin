"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenChecker = void 0;
const contract_1 = require("./contract");
const liquidity_1 = require("./liquidity");
const holders_1 = require("./holders");
const rugcheck_1 = require("./rugcheck");
const logger_1 = require("../utils/logger");
const node_fetch_1 = __importDefault(require("node-fetch"));
const config_1 = require("../config");
class TokenChecker {
    constructor() {
        this.contractChecker = new contract_1.ContractChecker();
        this.liquidityChecker = new liquidity_1.LiquidityChecker();
        this.holderChecker = new holders_1.HolderChecker();
        this.rugcheckChecker = new rugcheck_1.RugCheckChecker();
    }
    async analyzeToken(tokenAddress, pairData) {
        try {
            logger_1.logger.info(`🔬 Starting full analysis for ${tokenAddress}`);
            const [contractResult, liquidityResult, holderResult, rugcheckResult, honeypotResult] = await Promise.all([
                this.contractChecker.checkContract(tokenAddress),
                this.liquidityChecker.checkLiquidity(tokenAddress, pairData),
                this.holderChecker.checkHolders(tokenAddress),
                this.rugcheckChecker.checkToken(tokenAddress),
                this.checkHoneypot(tokenAddress),
            ]);
            const weights = {
                contract: 0.25,
                liquidity: 0.20,
                holders: 0.20,
                rugcheck: 0.25,
                honeypot: 0.10,
            };
            const overall = Math.round(contractResult.score * weights.contract +
                liquidityResult.score * weights.liquidity +
                holderResult.score * weights.holders +
                rugcheckResult.score * weights.rugcheck +
                honeypotResult.score * weights.honeypot);
            let category;
            if (overall >= 80)
                category = 'SAFE';
            else if (overall >= 60)
                category = 'MODERATE';
            else if (overall >= 40)
                category = 'RISKY';
            else
                category = 'DANGEROUS';
            const tradeable = overall >= config_1.config.minScore;
            const criticalFlags = [
                ...contractResult.flags.filter(f => f.includes('MINT_AUTHORITY')),
                ...rugcheckResult.flags.filter(f => f.includes('RUGGED')),
                ...honeypotResult.flags.filter(f => f.includes('HONEYPOT')),
            ];
            const result = {
                overall: criticalFlags.length > 0 ? Math.min(overall, 30) : overall,
                contract: contractResult,
                liquidity: liquidityResult,
                holders: holderResult,
                rugcheck: rugcheckResult,
                honeypot: honeypotResult,
                category: criticalFlags.length > 0 ? 'DANGEROUS' : category,
                tradeable: criticalFlags.length > 0 ? false : tradeable,
            };
            logger_1.logger.info(`📊 Analysis complete for ${tokenAddress}: Score ${result.overall}/100 [${result.category}] ${result.tradeable ? '✅ TRADEABLE' : '❌ SKIP'}`);
            return result;
        }
        catch (error) {
            logger_1.logger.error(`Full analysis failed for ${tokenAddress}`, error);
            return {
                overall: 0,
                contract: { score: 0, flags: ['ANALYSIS_FAILED'], hasMintAuthority: true, hasFreezeAuthority: true, isRevoked: false },
                liquidity: { score: 0, flags: ['ANALYSIS_FAILED'], liquidityUsd: 0, isLpBurned: false, isLpLocked: false, lpRatioToMcap: 0 },
                holders: { score: 0, flags: ['ANALYSIS_FAILED'], totalHolders: 0, top10Concentration: 100, devWalletPct: 0, bundledWallets: 0 },
                rugcheck: { score: 0, flags: ['ANALYSIS_FAILED'], risks: [], warnings: [] },
                honeypot: { score: 0, flags: ['ANALYSIS_FAILED'], canSell: false, sellTax: 100, buyTax: 100 },
                category: 'DANGEROUS',
                tradeable: false,
            };
        }
    }
    async checkHoneypot(tokenAddress) {
        try {
            logger_1.logger.debug(`Honeypot check for ${tokenAddress}`);
            const SOL_MINT = 'So11111111111111111111111111111111111111112';
            const testAmount = 100000;
            const buyQuoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT}&outputMint=${tokenAddress}&amount=${testAmount}&slippageBps=1500`;
            const buyResponse = await (0, node_fetch_1.default)(buyQuoteUrl);
            if (!buyResponse.ok) {
                return { score: 50, flags: ['HONEYPOT_CHECK_INCONCLUSIVE'], canSell: true, sellTax: 0, buyTax: 0 };
            }
            const buyQuote = await buyResponse.json();
            if (!buyQuote.outAmount || buyQuote.outAmount === '0') {
                return { score: 20, flags: ['CANNOT_BUY'], canSell: false, sellTax: 100, buyTax: 100 };
            }
            const sellAmount = buyQuote.outAmount;
            const sellQuoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=${SOL_MINT}&amount=${sellAmount}&slippageBps=1500`;
            const sellResponse = await (0, node_fetch_1.default)(sellQuoteUrl);
            if (!sellResponse.ok) {
                return { score: 20, flags: ['HONEYPOT_SELL_BLOCKED'], canSell: false, sellTax: 100, buyTax: 0 };
            }
            const sellQuote = await sellResponse.json();
            if (!sellQuote.outAmount || sellQuote.outAmount === '0') {
                return { score: 0, flags: ['HONEYPOT_CONFIRMED'], canSell: false, sellTax: 100, buyTax: 0 };
            }
            const solIn = testAmount;
            const solOut = parseInt(sellQuote.outAmount);
            const effectiveTax = ((solIn - solOut) / solIn) * 100;
            let score = 100;
            const flags = [];
            let sellTax = Math.max(0, effectiveTax);
            if (sellTax > 50) {
                flags.push('EXTREME_TAX');
                score = 10;
            }
            else if (sellTax > 20) {
                flags.push('HIGH_TAX');
                score = 40;
            }
            else if (sellTax > 10) {
                flags.push('MODERATE_TAX');
                score = 70;
            }
            const priceImpact = parseFloat(buyQuote.priceImpactPct || '0');
            if (priceImpact > 10) {
                flags.push('HIGH_PRICE_IMPACT');
                score -= 20;
            }
            return {
                score: Math.max(0, score),
                flags,
                canSell: true,
                sellTax: Math.round(sellTax * 100) / 100,
                buyTax: Math.round(priceImpact * 100) / 100,
            };
        }
        catch (error) {
            logger_1.logger.error(`Honeypot check failed for ${tokenAddress}`, error);
            return { score: 50, flags: ['HONEYPOT_CHECK_FAILED'], canSell: true, sellTax: 0, buyTax: 0 };
        }
    }
    async quickCheck(tokenAddress) {
        const [contract, rugcheck] = await Promise.all([
            this.contractChecker.checkContract(tokenAddress),
            this.rugcheckChecker.checkToken(tokenAddress),
        ]);
        const score = Math.round(contract.score * 0.5 + rugcheck.score * 0.5);
        return {
            score,
            tradeable: score >= config_1.config.minScore,
            flags: [...contract.flags, ...rugcheck.flags],
        };
    }
}
exports.TokenChecker = TokenChecker;

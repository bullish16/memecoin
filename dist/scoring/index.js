"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoringEngine = void 0;
const logger_1 = require("../utils/logger");
class ScoringEngine {
    calculateOpportunityScore(pair) {
        const momentum = this.calculateMomentum(pair);
        const freshness = this.calculateFreshness(pair);
        const buyPressure = this.calculateBuyPressure(pair);
        const liquidityDepth = this.calculateLiquidityDepth(pair);
        const overall = Math.round(momentum * 0.30 +
            freshness * 0.20 +
            buyPressure * 0.30 +
            liquidityDepth * 0.20);
        return { momentum, freshness, buyPressure, liquidityDepth, overall };
    }
    shouldTrade(safetyScore, pair) {
        if (!safetyScore.tradeable) {
            return {
                decision: false,
                reason: `Safety score too low: ${safetyScore.overall}/100 [${safetyScore.category}]`,
                confidence: 0,
                opportunity: { momentum: 0, freshness: 0, buyPressure: 0, liquidityDepth: 0, overall: 0 },
            };
        }
        const opportunity = this.calculateOpportunityScore(pair);
        if (opportunity.overall < 50) {
            return {
                decision: false,
                reason: `Opportunity score too low: ${opportunity.overall}/100`,
                confidence: 0,
                opportunity,
            };
        }
        const confidence = Math.round(safetyScore.overall * 0.5 + opportunity.overall * 0.5);
        const decision = confidence >= 60;
        const reason = decision
            ? `✅ TRADE: Safety ${safetyScore.overall}, Opportunity ${opportunity.overall}, Confidence ${confidence}`
            : `❌ SKIP: Confidence ${confidence} below threshold`;
        logger_1.logger.info(`Scoring decision for ${pair.baseToken.symbol}: ${reason}`);
        return { decision, reason, confidence, opportunity };
    }
    calculateMomentum(pair) {
        let score = 50;
        const vol5m = pair.volume.m5;
        const vol1hAvg = pair.volume.h1 / 12;
        if (vol1hAvg > 0) {
            const volumeAcceleration = vol5m / vol1hAvg;
            if (volumeAcceleration > 3)
                score += 30;
            else if (volumeAcceleration > 2)
                score += 20;
            else if (volumeAcceleration > 1.5)
                score += 10;
            else if (volumeAcceleration < 0.5)
                score -= 20;
        }
        const priceChange5m = pair.priceChange.m5;
        const priceChange1h = pair.priceChange.h1;
        if (priceChange5m > 0 && priceChange5m < 50) {
            score += 15;
        }
        else if (priceChange5m > 50) {
            score -= 10;
        }
        else if (priceChange5m < -20) {
            score -= 20;
        }
        if (priceChange1h > 0 && priceChange1h < 100) {
            score += 10;
        }
        else if (priceChange1h > 200) {
            score -= 15;
        }
        return Math.max(0, Math.min(100, score));
    }
    calculateFreshness(pair) {
        if (!pair.pairCreatedAt)
            return 50;
        const ageMs = Date.now() - pair.pairCreatedAt * 1000;
        const ageMinutes = ageMs / 60000;
        if (ageMinutes < 2)
            return 30;
        if (ageMinutes < 5)
            return 70;
        if (ageMinutes < 15)
            return 100;
        if (ageMinutes < 30)
            return 80;
        if (ageMinutes < 60)
            return 60;
        if (ageMinutes < 120)
            return 40;
        return 20;
    }
    calculateBuyPressure(pair) {
        let score = 50;
        const buys5m = pair.txns.m5.buys;
        const sells5m = pair.txns.m5.sells;
        const total5m = buys5m + sells5m;
        if (total5m > 0) {
            const buyRatio5m = buys5m / total5m;
            if (buyRatio5m > 0.7)
                score += 25;
            else if (buyRatio5m > 0.6)
                score += 15;
            else if (buyRatio5m < 0.3)
                score -= 30;
            else if (buyRatio5m < 0.4)
                score -= 15;
        }
        const buys1h = pair.txns.h1.buys;
        const sells1h = pair.txns.h1.sells;
        const total1h = buys1h + sells1h;
        if (total1h > 0) {
            const buyRatio1h = buys1h / total1h;
            if (buyRatio1h > 0.6)
                score += 15;
            else if (buyRatio1h < 0.4)
                score -= 15;
        }
        if (total5m > 20)
            score += 10;
        else if (total5m < 3)
            score -= 10;
        return Math.max(0, Math.min(100, score));
    }
    calculateLiquidityDepth(pair) {
        const liquidity = pair.liquidity?.usd || 0;
        const marketCap = pair.marketCap || pair.fdv || 0;
        if (liquidity === 0)
            return 0;
        let score = 50;
        if (liquidity > 50000)
            score += 20;
        else if (liquidity > 20000)
            score += 15;
        else if (liquidity > 10000)
            score += 10;
        else if (liquidity > 5000)
            score += 5;
        else if (liquidity < 2000)
            score -= 20;
        if (marketCap > 0) {
            const ratio = liquidity / marketCap;
            if (ratio > 0.3)
                score += 20;
            else if (ratio > 0.15)
                score += 10;
            else if (ratio < 0.05)
                score -= 20;
        }
        return Math.max(0, Math.min(100, score));
    }
    formatScoreReport(safety, opportunity, symbol) {
        const bar = (score) => {
            const filled = Math.round(score / 10);
            return '█'.repeat(filled) + '░'.repeat(10 - filled);
        };
        return [
            `═══ ${symbol} Score Report ═══`,
            ``,
            `Safety:      ${bar(safety.overall)} ${safety.overall}/100 [${safety.category}]`,
            `  Contract:  ${bar(safety.contract.score)} ${safety.contract.score}`,
            `  Liquidity: ${bar(safety.liquidity.score)} ${safety.liquidity.score}`,
            `  Holders:   ${bar(safety.holders.score)} ${safety.holders.score}`,
            `  RugCheck:  ${bar(safety.rugcheck.score)} ${safety.rugcheck.score}`,
            `  Honeypot:  ${bar(safety.honeypot.score)} ${safety.honeypot.score}`,
            ``,
            `Opportunity: ${bar(opportunity.overall)} ${opportunity.overall}/100`,
            `  Momentum:  ${bar(opportunity.momentum)} ${opportunity.momentum}`,
            `  Freshness: ${bar(opportunity.freshness)} ${opportunity.freshness}`,
            `  BuyPress:  ${bar(opportunity.buyPressure)} ${opportunity.buyPressure}`,
            `  LiqDepth:  ${bar(opportunity.liquidityDepth)} ${opportunity.liquidityDepth}`,
            ``,
            `Flags: ${[...safety.contract.flags, ...safety.liquidity.flags, ...safety.holders.flags, ...safety.rugcheck.flags, ...safety.honeypot.flags].join(', ') || 'None'}`,
            `═══════════════════════════`,
        ].join('\n');
    }
}
exports.ScoringEngine = ScoringEngine;

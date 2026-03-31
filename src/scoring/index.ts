import { TokenScore, TokenPair } from '../types';
import { logger } from '../utils/logger';

export interface OpportunityScore {
  momentum: number;       // 0-100: volume/price momentum
  freshness: number;      // 0-100: how new the token is
  buyPressure: number;    // 0-100: buy vs sell ratio
  liquidityDepth: number; // 0-100: liquidity relative to mcap
  overall: number;        // 0-100: combined opportunity score
}

export class ScoringEngine {
  /**
   * Calculate opportunity score based on market data.
   * This is separate from the safety score (TokenScore).
   * A token needs to pass BOTH safety and opportunity thresholds.
   */
  calculateOpportunityScore(pair: TokenPair): OpportunityScore {
    const momentum = this.calculateMomentum(pair);
    const freshness = this.calculateFreshness(pair);
    const buyPressure = this.calculateBuyPressure(pair);
    const liquidityDepth = this.calculateLiquidityDepth(pair);

    const overall = Math.round(
      momentum * 0.30 +
      freshness * 0.20 +
      buyPressure * 0.30 +
      liquidityDepth * 0.20
    );

    return { momentum, freshness, buyPressure, liquidityDepth, overall };
  }

  /**
   * Combined decision: should we trade this token?
   */
  shouldTrade(safetyScore: TokenScore, pair: TokenPair): {
    decision: boolean;
    reason: string;
    confidence: number;
    opportunity: OpportunityScore;
  } {
    // Safety gate: must pass safety first
    if (!safetyScore.tradeable) {
      return {
        decision: false,
        reason: `Safety score too low: ${safetyScore.overall}/100 [${safetyScore.category}]`,
        confidence: 0,
        opportunity: { momentum: 0, freshness: 0, buyPressure: 0, liquidityDepth: 0, overall: 0 },
      };
    }

    const opportunity = this.calculateOpportunityScore(pair);

    // Need at least 50 opportunity score
    if (opportunity.overall < 50) {
      return {
        decision: false,
        reason: `Opportunity score too low: ${opportunity.overall}/100`,
        confidence: 0,
        opportunity,
      };
    }

    // Calculate confidence (0-100)
    const confidence = Math.round(
      safetyScore.overall * 0.5 + opportunity.overall * 0.5
    );

    // Only trade with confidence >= 60
    const decision = confidence >= 60;

    const reason = decision
      ? `✅ TRADE: Safety ${safetyScore.overall}, Opportunity ${opportunity.overall}, Confidence ${confidence}`
      : `❌ SKIP: Confidence ${confidence} below threshold`;

    logger.info(`Scoring decision for ${pair.baseToken.symbol}: ${reason}`);

    return { decision, reason, confidence, opportunity };
  }

  private calculateMomentum(pair: TokenPair): number {
    let score = 50; // Base score

    // Volume acceleration: compare 5m volume to 1h average
    const vol5m = pair.volume.m5;
    const vol1hAvg = pair.volume.h1 / 12; // Average 5-min volume in last hour

    if (vol1hAvg > 0) {
      const volumeAcceleration = vol5m / vol1hAvg;
      if (volumeAcceleration > 3) score += 30;
      else if (volumeAcceleration > 2) score += 20;
      else if (volumeAcceleration > 1.5) score += 10;
      else if (volumeAcceleration < 0.5) score -= 20;
    }

    // Price momentum
    const priceChange5m = pair.priceChange.m5;
    const priceChange1h = pair.priceChange.h1;

    // We want positive but not parabolic momentum
    if (priceChange5m > 0 && priceChange5m < 50) {
      score += 15;
    } else if (priceChange5m > 50) {
      score -= 10; // Too fast, might be pump
    } else if (priceChange5m < -20) {
      score -= 20; // Dumping
    }

    if (priceChange1h > 0 && priceChange1h < 100) {
      score += 10;
    } else if (priceChange1h > 200) {
      score -= 15; // Likely overextended
    }

    return Math.max(0, Math.min(100, score));
  }

  private calculateFreshness(pair: TokenPair): number {
    if (!pair.pairCreatedAt) return 50;

    const ageMs = Date.now() - pair.pairCreatedAt * 1000;
    const ageMinutes = ageMs / 60000;

    // Sweet spot: 5-30 minutes old
    if (ageMinutes < 2) return 30;       // Too new, risky
    if (ageMinutes < 5) return 70;       // Very fresh
    if (ageMinutes < 15) return 100;     // Ideal window
    if (ageMinutes < 30) return 80;      // Still good
    if (ageMinutes < 60) return 60;      // Getting older
    if (ageMinutes < 120) return 40;     // Late entry
    return 20;                            // Very late
  }

  private calculateBuyPressure(pair: TokenPair): number {
    let score = 50;

    // 5-minute buy/sell ratio
    const buys5m = pair.txns.m5.buys;
    const sells5m = pair.txns.m5.sells;
    const total5m = buys5m + sells5m;

    if (total5m > 0) {
      const buyRatio5m = buys5m / total5m;
      if (buyRatio5m > 0.7) score += 25;
      else if (buyRatio5m > 0.6) score += 15;
      else if (buyRatio5m < 0.3) score -= 30; // Heavy selling
      else if (buyRatio5m < 0.4) score -= 15;
    }

    // 1-hour buy/sell ratio
    const buys1h = pair.txns.h1.buys;
    const sells1h = pair.txns.h1.sells;
    const total1h = buys1h + sells1h;

    if (total1h > 0) {
      const buyRatio1h = buys1h / total1h;
      if (buyRatio1h > 0.6) score += 15;
      else if (buyRatio1h < 0.4) score -= 15;
    }

    // Transaction count (activity level)
    if (total5m > 20) score += 10;
    else if (total5m < 3) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  private calculateLiquidityDepth(pair: TokenPair): number {
    const liquidity = pair.liquidity?.usd || 0;
    const marketCap = pair.marketCap || pair.fdv || 0;

    if (liquidity === 0) return 0;

    let score = 50;

    // Absolute liquidity
    if (liquidity > 50000) score += 20;
    else if (liquidity > 20000) score += 15;
    else if (liquidity > 10000) score += 10;
    else if (liquidity > 5000) score += 5;
    else if (liquidity < 2000) score -= 20;

    // Liquidity to market cap ratio (higher = safer for trading)
    if (marketCap > 0) {
      const ratio = liquidity / marketCap;
      if (ratio > 0.3) score += 20;
      else if (ratio > 0.15) score += 10;
      else if (ratio < 0.05) score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Format score for display
   */
  formatScoreReport(safety: TokenScore, opportunity: OpportunityScore, symbol: string): string {
    const bar = (score: number) => {
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

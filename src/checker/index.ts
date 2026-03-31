import { ContractChecker } from './contract';
import { LiquidityChecker } from './liquidity';
import { HolderChecker } from './holders';
import { RugCheckChecker } from './rugcheck';
import { TokenScore, TokenPair, HoneypotCheck } from '../types';
import { logger } from '../utils/logger';
import { solanaUtils } from '../utils/solana';
import fetch from 'node-fetch';
import { config } from '../config';

export class TokenChecker {
  private contractChecker: ContractChecker;
  private liquidityChecker: LiquidityChecker;
  private holderChecker: HolderChecker;
  private rugcheckChecker: RugCheckChecker;

  constructor() {
    this.contractChecker = new ContractChecker();
    this.liquidityChecker = new LiquidityChecker();
    this.holderChecker = new HolderChecker();
    this.rugcheckChecker = new RugCheckChecker();
  }

  async analyzeToken(tokenAddress: string, pairData?: TokenPair): Promise<TokenScore> {
    try {
      logger.info(`🔬 Starting full analysis for ${tokenAddress}`);

      // Run all checks in parallel
      const [contractResult, liquidityResult, holderResult, rugcheckResult, honeypotResult] =
        await Promise.all([
          this.contractChecker.checkContract(tokenAddress),
          this.liquidityChecker.checkLiquidity(tokenAddress, pairData),
          this.holderChecker.checkHolders(tokenAddress),
          this.rugcheckChecker.checkToken(tokenAddress),
          this.checkHoneypot(tokenAddress),
        ]);

      // Calculate overall score with weighted averages
      const weights = {
        contract: 0.25,
        liquidity: 0.20,
        holders: 0.20,
        rugcheck: 0.25,
        honeypot: 0.10,
      };

      const overall = Math.round(
        contractResult.score * weights.contract +
        liquidityResult.score * weights.liquidity +
        holderResult.score * weights.holders +
        rugcheckResult.score * weights.rugcheck +
        honeypotResult.score * weights.honeypot
      );

      // Determine category
      let category: 'SAFE' | 'MODERATE' | 'RISKY' | 'DANGEROUS';
      if (overall >= 80) category = 'SAFE';
      else if (overall >= 60) category = 'MODERATE';
      else if (overall >= 40) category = 'RISKY';
      else category = 'DANGEROUS';

      const tradeable = overall >= config.minScore;

      // Check for critical red flags that override score
      const criticalFlags = [
        ...contractResult.flags.filter(f => f.includes('MINT_AUTHORITY')),
        ...rugcheckResult.flags.filter(f => f.includes('RUGGED')),
        ...honeypotResult.flags.filter(f => f.includes('HONEYPOT')),
      ];

      const result: TokenScore = {
        overall: criticalFlags.length > 0 ? Math.min(overall, 30) : overall,
        contract: contractResult,
        liquidity: liquidityResult,
        holders: holderResult,
        rugcheck: rugcheckResult,
        honeypot: honeypotResult,
        category: criticalFlags.length > 0 ? 'DANGEROUS' : category,
        tradeable: criticalFlags.length > 0 ? false : tradeable,
      };

      logger.info(
        `📊 Analysis complete for ${tokenAddress}: Score ${result.overall}/100 [${result.category}] ${result.tradeable ? '✅ TRADEABLE' : '❌ SKIP'}`
      );

      return result;
    } catch (error) {
      logger.error(`Full analysis failed for ${tokenAddress}`, error);
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

  private async checkHoneypot(tokenAddress: string): Promise<HoneypotCheck> {
    try {
      logger.debug(`Honeypot check for ${tokenAddress}`);

      // Simulate a swap via Jupiter to check if sells work
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const testAmount = 100000; // 0.0001 SOL in lamports

      // Try to get a quote for buying
      const buyQuoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${SOL_MINT}&outputMint=${tokenAddress}&amount=${testAmount}&slippageBps=1500`;
      const buyResponse = await fetch(buyQuoteUrl);

      if (!buyResponse.ok) {
        return { score: 50, flags: ['HONEYPOT_CHECK_INCONCLUSIVE'], canSell: true, sellTax: 0, buyTax: 0 };
      }

      const buyQuote = await buyResponse.json() as any;

      if (!buyQuote.outAmount || buyQuote.outAmount === '0') {
        return { score: 20, flags: ['CANNOT_BUY'], canSell: false, sellTax: 100, buyTax: 100 };
      }

      // Try to get a quote for selling back
      const sellAmount = buyQuote.outAmount;
      const sellQuoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=${SOL_MINT}&amount=${sellAmount}&slippageBps=1500`;
      const sellResponse = await fetch(sellQuoteUrl);

      if (!sellResponse.ok) {
        return { score: 20, flags: ['HONEYPOT_SELL_BLOCKED'], canSell: false, sellTax: 100, buyTax: 0 };
      }

      const sellQuote = await sellResponse.json() as any;

      if (!sellQuote.outAmount || sellQuote.outAmount === '0') {
        return { score: 0, flags: ['HONEYPOT_CONFIRMED'], canSell: false, sellTax: 100, buyTax: 0 };
      }

      // Calculate effective tax by comparing buy and sell amounts
      const solIn = testAmount;
      const solOut = parseInt(sellQuote.outAmount);
      const effectiveTax = ((solIn - solOut) / solIn) * 100;

      let score = 100;
      const flags: string[] = [];
      let sellTax = Math.max(0, effectiveTax);

      if (sellTax > 50) {
        flags.push('EXTREME_TAX');
        score = 10;
      } else if (sellTax > 20) {
        flags.push('HIGH_TAX');
        score = 40;
      } else if (sellTax > 10) {
        flags.push('MODERATE_TAX');
        score = 70;
      }

      // Price impact from Jupiter
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
    } catch (error) {
      logger.error(`Honeypot check failed for ${tokenAddress}`, error);
      return { score: 50, flags: ['HONEYPOT_CHECK_FAILED'], canSell: true, sellTax: 0, buyTax: 0 };
    }
  }

  // Quick check - only contract + rugcheck (faster, for initial filtering)
  async quickCheck(tokenAddress: string): Promise<{ score: number; tradeable: boolean; flags: string[] }> {
    const [contract, rugcheck] = await Promise.all([
      this.contractChecker.checkContract(tokenAddress),
      this.rugcheckChecker.checkToken(tokenAddress),
    ]);

    const score = Math.round(contract.score * 0.5 + rugcheck.score * 0.5);
    return {
      score,
      tradeable: score >= config.minScore,
      flags: [...contract.flags, ...rugcheck.flags],
    };
  }
}

import { DexScreenerAPI } from './dexscreener';
import { TokenPair } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

export class TokenScanner {
  private dexScreener: DexScreenerAPI;
  private isRunning = false;
  private scanInterval?: NodeJS.Timeout;
  private seenTokens = new Set<string>();

  constructor() {
    this.dexScreener = new DexScreenerAPI();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warning('Scanner is already running');
      return;
    }

    this.isRunning = true;
    logger.success('Token scanner started');

    // Initial scan
    await this.performScan();

    // Set up recurring scans
    this.scanInterval = setInterval(async () => {
      await this.performScan();
    }, config.scanIntervalMs);
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = undefined;
    }
    logger.info('Token scanner stopped');
  }

  private async performScan(): Promise<TokenPair[]> {
    try {
      logger.scanner('Starting scan for new tokens...');

      // Get new pairs from DexScreener
      const [newPairs, pumpGraduates] = await Promise.all([
        this.dexScreener.getNewPairs(),
        this.dexScreener.getPumpFunGraduates()
      ]);

      // Combine and deduplicate
      const allPairs = [...newPairs, ...pumpGraduates];
      const uniquePairs = this.deduplicatePairs(allPairs);

      // Filter out tokens we've already seen
      const freshTokens = uniquePairs.filter(pair => {
        const tokenAddress = pair.baseToken.address;
        if (this.seenTokens.has(tokenAddress)) {
          return false;
        }
        this.seenTokens.add(tokenAddress);
        return true;
      });

      if (freshTokens.length > 0) {
        logger.scanner(`Found ${freshTokens.length} new tokens to analyze`);
        
        // Emit event for each new token
        for (const pair of freshTokens) {
          this.onNewTokenFound(pair);
        }
      } else {
        logger.scanner('No new tokens found in this scan');
      }

      return freshTokens;
    } catch (error) {
      logger.error('Error during token scan', error);
      return [];
    }
  }

  private deduplicatePairs(pairs: TokenPair[]): TokenPair[] {
    const seen = new Set<string>();
    return pairs.filter(pair => {
      const tokenAddress = pair.baseToken.address;
      if (seen.has(tokenAddress)) {
        return false;
      }
      seen.add(tokenAddress);
      return true;
    });
  }

  private onNewTokenFound(pair: TokenPair): void {
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

    logger.scanner(`New token detected: ${pair.baseToken.symbol}`, tokenInfo);
    
    // Emit event that can be listened to by the main bot
    this.emit('newToken', pair);
  }

  private emit(event: string, data: any): void {
    // Simple event system - in a real implementation, you might use EventEmitter
    // For now, we'll use a callback system
    if (this.onNewTokenCallback) {
      this.onNewTokenCallback(data);
    }
  }

  private onNewTokenCallback?: (pair: TokenPair) => void;

  onNewToken(callback: (pair: TokenPair) => void): void {
    this.onNewTokenCallback = callback;
  }

  // Manual scan method for testing
  async scanNow(): Promise<TokenPair[]> {
    logger.info('Performing manual scan...');
    return await this.performScan();
  }

  // Get scanner status
  getStatus(): {
    isRunning: boolean;
    seenTokensCount: number;
    lastScanTime?: number;
  } {
    return {
      isRunning: this.isRunning,
      seenTokensCount: this.seenTokens.size,
      lastScanTime: Date.now()
    };
  }

  // Clear seen tokens cache
  clearCache(): void {
    this.seenTokens.clear();
    logger.info('Scanner cache cleared');
  }

  // Get price for a specific token
  async getTokenPrice(tokenAddress: string): Promise<number | null> {
    return await this.dexScreener.getTokenPrice(tokenAddress);
  }

  // Get detailed token info
  async getTokenInfo(tokenAddress: string) {
    return await this.dexScreener.getTokenInfo(tokenAddress);
  }
}
import fetch from 'node-fetch';
import { TokenPair, TokenInfo } from '../types';
import { logger } from '../utils/logger';

export class DexScreenerAPI {
  private baseUrl = 'https://api.dexscreener.com';
  private lastRequestTime = 0;
  private requestDelay = 1100; // Slightly over 1s to respect rate limits

  private async makeRequest(url: string): Promise<any> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve =>
        setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
      );
    }

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });
      this.lastRequestTime = Date.now();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`DexScreener API request failed: ${url}`, error);
      throw error;
    }
  }

  /**
   * Get new tokens from token-boosts (latest promoted/active tokens)
   * and token-profiles endpoints, then fetch their pair data
   */
  async getNewPairs(): Promise<TokenPair[]> {
    try {
      // Get latest boosted tokens on Solana
      const boosts = await this.makeRequest(`${this.baseUrl}/token-boosts/latest/v1`);

      if (!Array.isArray(boosts)) {
        logger.warning('Invalid response from token-boosts API');
        return [];
      }

      // Filter Solana tokens
      const solanaTokens = boosts
        .filter((t: any) => t.chainId === 'solana')
        .slice(0, 10); // Check top 10

      const allPairs: TokenPair[] = [];

      // Fetch pair data for each token
      for (const token of solanaTokens) {
        try {
          const tokenData = await this.getTokenInfo(token.tokenAddress);
          if (tokenData && tokenData.pairs.length > 0) {
            // Filter pairs: recent, with liquidity and volume
            const validPairs = tokenData.pairs.filter((pair: TokenPair) => {
              const age = pair.pairCreatedAt
                ? Date.now() - pair.pairCreatedAt * 1000
                : Infinity;
              const ageMinutes = age / 60000;
              const liquidity = pair.liquidity?.usd || 0;
              const volume = pair.volume?.h24 || 0;

              return ageMinutes < 1440 && liquidity > 1000 && volume > 500;
            });

            allPairs.push(...validPairs);
          }
        } catch {
          // Skip failed tokens
          continue;
        }
      }

      // Also search for new Solana memecoins
      try {
        const searchResults = await this.searchNewMemecoins();
        allPairs.push(...searchResults);
      } catch {
        // Non-critical
      }

      // Deduplicate
      const seen = new Set<string>();
      const unique = allPairs.filter(pair => {
        const addr = pair.baseToken.address;
        if (seen.has(addr)) return false;
        seen.add(addr);
        return true;
      });

      logger.scanner(`Found ${unique.length} pairs matching criteria`);
      return unique;
    } catch (error) {
      logger.error('Failed to get new pairs from DexScreener', error);
      return [];
    }
  }

  private async searchNewMemecoins(): Promise<TokenPair[]> {
    try {
      // Search for trending Solana tokens
      const data = await this.makeRequest(
        `${this.baseUrl}/latest/dex/search?q=solana pump`
      );

      if (!data.pairs || !Array.isArray(data.pairs)) return [];

      // Filter for Solana, recent, with good liquidity
      return data.pairs
        .filter((pair: any) => {
          if (pair.chainId !== 'solana') return false;
          const age = pair.pairCreatedAt
            ? Date.now() - pair.pairCreatedAt * 1000
            : Infinity;
          const liquidity = pair.liquidity?.usd || 0;
          const volume = pair.volume?.h24 || 0;
          return age < 30 * 60 * 1000 && liquidity > 1000 && volume > 500;
        })
        .map(this.transformPair);
    } catch {
      return [];
    }
  }

  async getTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    try {
      const url = `${this.baseUrl}/latest/dex/tokens/${tokenAddress}`;
      const data = await this.makeRequest(url);

      if (!data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
        return null;
      }

      const pairs = data.pairs.map(this.transformPair);
      const firstPair = pairs[0];

      return {
        address: tokenAddress,
        name: firstPair.baseToken.name,
        symbol: firstPair.baseToken.symbol,
        decimals: 9,
        supply: '0',
        pairs,
      };
    } catch (error) {
      logger.error(`Failed to get token info for ${tokenAddress}`, error);
      return null;
    }
  }

  async getPumpFunGraduates(): Promise<TokenPair[]> {
    try {
      // Use token-profiles to find recently active tokens
      const profiles = await this.makeRequest(
        `${this.baseUrl}/token-profiles/latest/v1`
      );

      if (!Array.isArray(profiles)) return [];

      const solanaProfiles = profiles
        .filter((p: any) => p.chainId === 'solana')
        .slice(0, 5);

      const pairs: TokenPair[] = [];

      for (const profile of solanaProfiles) {
        try {
          const tokenData = await this.getTokenInfo(profile.tokenAddress);
          if (tokenData) {
            const validPairs = tokenData.pairs.filter((p: TokenPair) => {
              const liquidity = p.liquidity?.usd || 0;
              const volume = p.volume?.h24 || 0;
              return liquidity > 5000 && volume > 1000;
            });
            pairs.push(...validPairs);
          }
        } catch {
          continue;
        }
      }

      logger.scanner(`Found ${pairs.length} potential Pump.fun graduates`);
      return pairs;
    } catch (error) {
      logger.error('Failed to get Pump.fun graduates', error);
      return [];
    }
  }

  async getTokenPrice(tokenAddress: string): Promise<number | null> {
    try {
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      if (!tokenInfo || tokenInfo.pairs.length === 0) return null;

      const bestPair = tokenInfo.pairs.reduce((prev, current) =>
        (current.liquidity?.usd || 0) > (prev.liquidity?.usd || 0) ? current : prev
      );

      return parseFloat(bestPair.priceUsd || '0');
    } catch (error) {
      logger.error(`Failed to get price for ${tokenAddress}`, error);
      return null;
    }
  }

  async getPairByAddress(pairAddress: string): Promise<TokenPair | null> {
    try {
      const url = `${this.baseUrl}/latest/dex/pairs/solana/${pairAddress}`;
      const data = await this.makeRequest(url);
      if (!data.pairs || data.pairs.length === 0) return null;
      return this.transformPair(data.pairs[0]);
    } catch {
      return null;
    }
  }

  private transformPair(pair: any): TokenPair {
    return {
      chainId: pair.chainId || 'solana',
      dexId: pair.dexId || 'raydium',
      url: pair.url || '',
      pairAddress: pair.pairAddress || '',
      baseToken: {
        address: pair.baseToken?.address || '',
        name: pair.baseToken?.name || '',
        symbol: pair.baseToken?.symbol || '',
      },
      quoteToken: {
        address: pair.quoteToken?.address || '',
        name: pair.quoteToken?.name || '',
        symbol: pair.quoteToken?.symbol || '',
      },
      priceNative: pair.priceNative || '0',
      priceUsd: pair.priceUsd,
      txns: {
        m5: { buys: pair.txns?.m5?.buys || 0, sells: pair.txns?.m5?.sells || 0 },
        h1: { buys: pair.txns?.h1?.buys || 0, sells: pair.txns?.h1?.sells || 0 },
        h6: { buys: pair.txns?.h6?.buys || 0, sells: pair.txns?.h6?.sells || 0 },
        h24: { buys: pair.txns?.h24?.buys || 0, sells: pair.txns?.h24?.sells || 0 },
      },
      volume: {
        h24: pair.volume?.h24 || 0,
        h6: pair.volume?.h6 || 0,
        h1: pair.volume?.h1 || 0,
        m5: pair.volume?.m5 || 0,
      },
      priceChange: {
        m5: pair.priceChange?.m5 || 0,
        h1: pair.priceChange?.h1 || 0,
        h6: pair.priceChange?.h6 || 0,
        h24: pair.priceChange?.h24 || 0,
      },
      liquidity: pair.liquidity
        ? { usd: pair.liquidity.usd || 0, base: pair.liquidity.base || 0, quote: pair.liquidity.quote || 0 }
        : undefined,
      fdv: pair.fdv,
      marketCap: pair.marketCap,
      pairCreatedAt: pair.pairCreatedAt,
    };
  }
}

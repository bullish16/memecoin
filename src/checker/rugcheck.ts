import fetch from 'node-fetch';
import { RugCheckResult } from '../types';
import { logger } from '../utils/logger';

interface RugCheckAPIResponse {
  mint: string;
  rugged: boolean;
  risks: Array<{
    name: string;
    description: string;
    level: 'danger' | 'warning' | 'info';
    score: number;
  }>;
  score: number;
  total_supply: string;
  creators_percent: number;
  fileMeta: {
    name: string;
    symbol: string;
    description: string;
    image: string;
  };
  markets: Array<{
    lp: {
      lpLockedPct: number;
      lpBurnedPct: number;
    };
  }>;
}

export class RugCheckChecker {
  private baseUrl = 'https://api.rugcheck.xyz/v1';
  private lastRequestTime = 0;
  private requestDelay = 2000; // 2 seconds between requests to be respectful

  async checkToken(tokenAddress: string): Promise<RugCheckResult> {
    try {
      logger.debug(`RugCheck analysis for token: ${tokenAddress}`);

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

    } catch (error) {
      logger.error(`RugCheck failed for ${tokenAddress}`, error);
      return {
        score: 0,
        flags: ['RUGCHECK_API_ERROR'],
        risks: ['Failed to connect to RugCheck API'],
        warnings: []
      };
    }
  }

  private async makeRequest(endpoint: string): Promise<any> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
      );
    }

    try {
      const url = `${this.baseUrl}${endpoint}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Solana-Memecoin-Bot/1.0',
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      this.lastRequestTime = Date.now();

      if (!response.ok) {
        if (response.status === 429) {
          logger.warning('RugCheck rate limit hit, waiting...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          return this.makeRequest(endpoint);
        }
        
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      logger.error('RugCheck API request failed', error);
      throw error;
    }
  }

  private parseRugCheckResponse(data: RugCheckAPIResponse): RugCheckResult {
    try {
      const flags: string[] = [];
      const risks: string[] = [];
      const warnings: string[] = [];
      let score = 100;

      // Check if token is flagged as rugged
      if (data.rugged) {
        flags.push('RUGCHECK_FLAGGED_AS_RUGGED');
        score = 0;
        risks.push('Token flagged as rugged by RugCheck');
        return { score, flags, risks, warnings };
      }

      // Process individual risk checks
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

      // Use RugCheck's own score if available
      if (typeof data.score === 'number') {
        score = Math.min(score, data.score);
      }

      // Check creator percentage
      if (data.creators_percent > 20) {
        flags.push('HIGH_CREATOR_PERCENTAGE');
        risks.push(`Creators own ${data.creators_percent}% of supply`);
        score -= 25;
      } else if (data.creators_percent > 10) {
        flags.push('MODERATE_CREATOR_PERCENTAGE');
        warnings.push(`Creators own ${data.creators_percent}% of supply`);
        score -= 10;
      }

      // Check liquidity pool status
      if (data.markets && data.markets.length > 0) {
        const market = data.markets[0]; // Use primary market
        if (market.lp) {
          const lpLocked = market.lp.lpLockedPct || 0;
          const lpBurned = market.lp.lpBurnedPct || 0;
          const totalLpSecured = lpLocked + lpBurned;

          if (totalLpSecured < 50) {
            flags.push('INSUFFICIENT_LP_SECURITY');
            risks.push(`Only ${totalLpSecured}% of LP is locked/burned`);
            score -= 30;
          } else if (totalLpSecured < 80) {
            flags.push('PARTIAL_LP_SECURITY');
            warnings.push(`${totalLpSecured}% of LP is locked/burned`);
            score -= 10;
          }
        }
      }

      // Additional checks based on metadata
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

    } catch (error) {
      logger.error('Failed to parse RugCheck response', error);
      return {
        score: 0,
        flags: ['RUGCHECK_PARSE_ERROR'],
        risks: ['Failed to parse RugCheck response'],
        warnings: []
      };
    }
  }

  // Check multiple tokens (with rate limiting)
  async checkMultipleTokens(tokenAddresses: string[]): Promise<Map<string, RugCheckResult>> {
    const results = new Map<string, RugCheckResult>();
    
    logger.info(`Checking ${tokenAddresses.length} tokens with RugCheck...`);
    
    for (let i = 0; i < tokenAddresses.length; i++) {
      const address = tokenAddresses[i];
      try {
        const result = await this.checkToken(address);
        results.set(address, result);
        
        logger.debug(`RugCheck completed for ${address} (${i + 1}/${tokenAddresses.length})`);
        
        // Add delay between requests to respect rate limits
        if (i < tokenAddresses.length - 1) {
          await new Promise(resolve => setTimeout(resolve, this.requestDelay));
        }
      } catch (error) {
        logger.error(`RugCheck failed for ${address}`, error);
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

  // Get detailed report for a token
  async getDetailedReport(tokenAddress: string): Promise<{
    summary: RugCheckResult;
    metadata: any;
    markets: any[];
    rawData: any;
  }> {
    try {
      const data = await this.makeRequest(`/tokens/${tokenAddress}/report`);
      
      return {
        summary: this.parseRugCheckResponse(data),
        metadata: data.fileMeta || {},
        markets: data.markets || [],
        rawData: data
      };
    } catch (error) {
      logger.error(`Failed to get detailed RugCheck report for ${tokenAddress}`, error);
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

  // Check if RugCheck service is available
  async healthCheck(): Promise<boolean> {
    try {
      await this.makeRequest('/health');
      return true;
    } catch (error) {
      logger.error('RugCheck health check failed', error);
      return false;
    }
  }

  // Get service status and limits
  getServiceInfo(): {
    name: string;
    baseUrl: string;
    requestDelay: number;
    lastRequestTime: number;
  } {
    return {
      name: 'RugCheck.xyz',
      baseUrl: this.baseUrl,
      requestDelay: this.requestDelay,
      lastRequestTime: this.lastRequestTime
    };
  }
}
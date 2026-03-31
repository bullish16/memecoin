import { PublicKey } from '@solana/web3.js';
import { solanaUtils } from '../utils/solana';
import { ContractCheck } from '../types';
import { logger } from '../utils/logger';

export class ContractChecker {
  async checkContract(tokenAddress: string): Promise<ContractCheck> {
    try {
      logger.debug(`Checking contract for token: ${tokenAddress}`);

      const mintInfo = await solanaUtils.getMintInfo(tokenAddress);
      
      if (!mintInfo) {
        return {
          score: 0,
          flags: ['INVALID_TOKEN_ADDRESS'],
          hasMintAuthority: true,
          hasFreezeAuthority: true,
          isRevoked: false
        };
      }

      const flags: string[] = [];
      let score = 100;

      // Check mint authority (should be revoked)
      if (mintInfo.hasMintAuthority) {
        flags.push('MINT_AUTHORITY_NOT_REVOKED');
        score -= 40; // Major red flag
        logger.warning(`Token ${tokenAddress} has mint authority - RISK!`);
      }

      // Check freeze authority (should be revoked)
      if (mintInfo.hasFreezeAuthority) {
        flags.push('FREEZE_AUTHORITY_NOT_REVOKED');
        score -= 30; // Major red flag
        logger.warning(`Token ${tokenAddress} has freeze authority - RISK!`);
      }

      // Check if token is initialized
      if (!mintInfo.isInitialized) {
        flags.push('TOKEN_NOT_INITIALIZED');
        score -= 50;
      }

      // Additional contract checks
      await this.performAdditionalChecks(tokenAddress, flags, score);

      const isRevoked = !mintInfo.hasMintAuthority && !mintInfo.hasFreezeAuthority;

      const result: ContractCheck = {
        score: Math.max(0, score),
        flags,
        hasMintAuthority: mintInfo.hasMintAuthority,
        hasFreezeAuthority: mintInfo.hasFreezeAuthority,
        isRevoked
      };

      logger.debug(`Contract check completed for ${tokenAddress}`, result);
      return result;

    } catch (error) {
      logger.error(`Failed to check contract for ${tokenAddress}`, error);
      return {
        score: 0,
        flags: ['CONTRACT_CHECK_FAILED'],
        hasMintAuthority: true,
        hasFreezeAuthority: true,
        isRevoked: false
      };
    }
  }

  private async performAdditionalChecks(
    tokenAddress: string,
    flags: string[],
    score: number
  ): Promise<void> {
    try {
      // Check if the token has proper metadata
      const hasMetadata = await this.checkTokenMetadata(tokenAddress);
      if (!hasMetadata) {
        flags.push('NO_TOKEN_METADATA');
        score -= 10;
      }

      // Check supply characteristics
      const supplyCheck = await this.checkSupplyCharacteristics(tokenAddress);
      if (!supplyCheck.isNormal) {
        flags.push(...supplyCheck.flags);
        score -= supplyCheck.penalty;
      }

    } catch (error) {
      logger.error('Additional contract checks failed', error);
    }
  }

  private async checkTokenMetadata(tokenAddress: string): Promise<boolean> {
    try {
      // In a full implementation, you would check for Metaplex metadata
      // For now, we'll do a basic check
      const connection = solanaUtils.getConnection();
      const mintPubkey = new PublicKey(tokenAddress);
      
      // Try to get metadata account
      const metadataSeeds = [
        Buffer.from('metadata'),
        Buffer.from('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), // Metaplex program ID
        mintPubkey.toBuffer(),
      ];
      
      // This is a simplified check - in practice you'd use the Metaplex SDK
      return true; // Assume metadata exists for now
    } catch (error) {
      return false;
    }
  }

  private async checkSupplyCharacteristics(tokenAddress: string): Promise<{
    isNormal: boolean;
    flags: string[];
    penalty: number;
  }> {
    try {
      const mintInfo = await solanaUtils.getMintInfo(tokenAddress);
      if (!mintInfo) {
        return { isNormal: false, flags: ['SUPPLY_CHECK_FAILED'], penalty: 20 };
      }

      const supply = BigInt(mintInfo.supply);
      const flags: string[] = [];
      let penalty = 0;

      // Check for suspicious supply amounts
      if (supply === 0n) {
        flags.push('ZERO_SUPPLY');
        penalty += 30;
      } else if (supply > 1000000000000000000n) { // Very large supply
        flags.push('EXTREMELY_LARGE_SUPPLY');
        penalty += 10;
      } else if (supply < 1000000n) { // Very small supply
        flags.push('EXTREMELY_SMALL_SUPPLY');
        penalty += 5;
      }

      // Check decimals
      if (mintInfo.decimals > 18) {
        flags.push('UNUSUAL_DECIMALS');
        penalty += 5;
      }

      return {
        isNormal: flags.length === 0,
        flags,
        penalty
      };
    } catch (error) {
      return { isNormal: false, flags: ['SUPPLY_CHECK_FAILED'], penalty: 20 };
    }
  }

  // Helper method to check multiple tokens at once
  async checkMultipleContracts(tokenAddresses: string[]): Promise<Map<string, ContractCheck>> {
    const results = new Map<string, ContractCheck>();
    
    // Process in batches to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      const batch = tokenAddresses.slice(i, i + batchSize);
      const batchPromises = batch.map(address => 
        this.checkContract(address).then(result => ({ address, result }))
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const promiseResult of batchResults) {
        if (promiseResult.status === 'fulfilled') {
          const { address, result } = promiseResult.value;
          results.set(address, result);
        }
      }

      // Small delay between batches
      if (i + batchSize < tokenAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }
}
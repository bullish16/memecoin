"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractChecker = void 0;
const web3_js_1 = require("@solana/web3.js");
const solana_1 = require("../utils/solana");
const logger_1 = require("../utils/logger");
class ContractChecker {
    async checkContract(tokenAddress) {
        try {
            logger_1.logger.debug(`Checking contract for token: ${tokenAddress}`);
            const mintInfo = await solana_1.solanaUtils.getMintInfo(tokenAddress);
            if (!mintInfo) {
                return {
                    score: 0,
                    flags: ['INVALID_TOKEN_ADDRESS'],
                    hasMintAuthority: true,
                    hasFreezeAuthority: true,
                    isRevoked: false
                };
            }
            const flags = [];
            let score = 100;
            if (mintInfo.hasMintAuthority) {
                flags.push('MINT_AUTHORITY_NOT_REVOKED');
                score -= 40;
                logger_1.logger.warning(`Token ${tokenAddress} has mint authority - RISK!`);
            }
            if (mintInfo.hasFreezeAuthority) {
                flags.push('FREEZE_AUTHORITY_NOT_REVOKED');
                score -= 30;
                logger_1.logger.warning(`Token ${tokenAddress} has freeze authority - RISK!`);
            }
            if (!mintInfo.isInitialized) {
                flags.push('TOKEN_NOT_INITIALIZED');
                score -= 50;
            }
            await this.performAdditionalChecks(tokenAddress, flags, score);
            const isRevoked = !mintInfo.hasMintAuthority && !mintInfo.hasFreezeAuthority;
            const result = {
                score: Math.max(0, score),
                flags,
                hasMintAuthority: mintInfo.hasMintAuthority,
                hasFreezeAuthority: mintInfo.hasFreezeAuthority,
                isRevoked
            };
            logger_1.logger.debug(`Contract check completed for ${tokenAddress}`, result);
            return result;
        }
        catch (error) {
            logger_1.logger.error(`Failed to check contract for ${tokenAddress}`, error);
            return {
                score: 0,
                flags: ['CONTRACT_CHECK_FAILED'],
                hasMintAuthority: true,
                hasFreezeAuthority: true,
                isRevoked: false
            };
        }
    }
    async performAdditionalChecks(tokenAddress, flags, score) {
        try {
            const hasMetadata = await this.checkTokenMetadata(tokenAddress);
            if (!hasMetadata) {
                flags.push('NO_TOKEN_METADATA');
                score -= 10;
            }
            const supplyCheck = await this.checkSupplyCharacteristics(tokenAddress);
            if (!supplyCheck.isNormal) {
                flags.push(...supplyCheck.flags);
                score -= supplyCheck.penalty;
            }
        }
        catch (error) {
            logger_1.logger.error('Additional contract checks failed', error);
        }
    }
    async checkTokenMetadata(tokenAddress) {
        try {
            const connection = solana_1.solanaUtils.getConnection();
            const mintPubkey = new web3_js_1.PublicKey(tokenAddress);
            const metadataSeeds = [
                Buffer.from('metadata'),
                Buffer.from('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'),
                mintPubkey.toBuffer(),
            ];
            return true;
        }
        catch (error) {
            return false;
        }
    }
    async checkSupplyCharacteristics(tokenAddress) {
        try {
            const mintInfo = await solana_1.solanaUtils.getMintInfo(tokenAddress);
            if (!mintInfo) {
                return { isNormal: false, flags: ['SUPPLY_CHECK_FAILED'], penalty: 20 };
            }
            const supply = BigInt(mintInfo.supply);
            const flags = [];
            let penalty = 0;
            if (supply === 0n) {
                flags.push('ZERO_SUPPLY');
                penalty += 30;
            }
            else if (supply > 1000000000000000000n) {
                flags.push('EXTREMELY_LARGE_SUPPLY');
                penalty += 10;
            }
            else if (supply < 1000000n) {
                flags.push('EXTREMELY_SMALL_SUPPLY');
                penalty += 5;
            }
            if (mintInfo.decimals > 18) {
                flags.push('UNUSUAL_DECIMALS');
                penalty += 5;
            }
            return {
                isNormal: flags.length === 0,
                flags,
                penalty
            };
        }
        catch (error) {
            return { isNormal: false, flags: ['SUPPLY_CHECK_FAILED'], penalty: 20 };
        }
    }
    async checkMultipleContracts(tokenAddresses) {
        const results = new Map();
        const batchSize = 5;
        for (let i = 0; i < tokenAddresses.length; i += batchSize) {
            const batch = tokenAddresses.slice(i, i + batchSize);
            const batchPromises = batch.map(address => this.checkContract(address).then(result => ({ address, result })));
            const batchResults = await Promise.allSettled(batchPromises);
            for (const promiseResult of batchResults) {
                if (promiseResult.status === 'fulfilled') {
                    const { address, result } = promiseResult.value;
                    results.set(address, result);
                }
            }
            if (i + batchSize < tokenAddresses.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        return results;
    }
}
exports.ContractChecker = ContractChecker;

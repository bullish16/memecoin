"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiquidityChecker = void 0;
const logger_1 = require("../utils/logger");
class LiquidityChecker {
    async checkLiquidity(tokenAddress, pairData) {
        try {
            logger_1.logger.debug(`Checking liquidity for token: ${tokenAddress}`);
            let liquidityUsd = 0;
            let isLpBurned = false;
            let isLpLocked = false;
            let lpRatioToMcap = 0;
            const flags = [];
            let score = 100;
            if (pairData?.liquidity) {
                liquidityUsd = pairData.liquidity.usd;
            }
            if (liquidityUsd < 1000) {
                flags.push('VERY_LOW_LIQUIDITY');
                score -= 40;
            }
            else if (liquidityUsd < 5000) {
                flags.push('LOW_LIQUIDITY');
                score -= 20;
            }
            else if (liquidityUsd < 10000) {
                flags.push('MODERATE_LIQUIDITY');
                score -= 5;
            }
            const lpStatus = await this.checkLPTokenStatus(tokenAddress, pairData);
            isLpBurned = lpStatus.isBurned;
            isLpLocked = lpStatus.isLocked;
            if (!isLpBurned && !isLpLocked) {
                flags.push('LP_NOT_BURNED_OR_LOCKED');
                score -= 30;
                logger_1.logger.warning(`LP tokens for ${tokenAddress} are not burned or locked - RUG RISK!`);
            }
            else if (isLpBurned) {
                logger_1.logger.success(`LP tokens for ${tokenAddress} are burned - SAFE`);
            }
            else if (isLpLocked) {
                logger_1.logger.info(`LP tokens for ${tokenAddress} are locked`);
                score -= 5;
            }
            if (pairData?.marketCap && liquidityUsd > 0) {
                lpRatioToMcap = (liquidityUsd / pairData.marketCap) * 100;
                if (lpRatioToMcap < 5) {
                    flags.push('LOW_LP_TO_MCAP_RATIO');
                    score -= 15;
                }
                else if (lpRatioToMcap > 50) {
                    flags.push('VERY_HIGH_LP_TO_MCAP_RATIO');
                    score -= 5;
                }
            }
            const concentrationCheck = await this.checkLiquidityConcentration(tokenAddress);
            if (!concentrationCheck.isWellDistributed) {
                flags.push(...concentrationCheck.flags);
                score -= concentrationCheck.penalty;
            }
            const result = {
                score: Math.max(0, score),
                flags,
                liquidityUsd,
                isLpBurned,
                isLpLocked,
                lpRatioToMcap
            };
            logger_1.logger.debug(`Liquidity check completed for ${tokenAddress}`, result);
            return result;
        }
        catch (error) {
            logger_1.logger.error(`Failed to check liquidity for ${tokenAddress}`, error);
            return {
                score: 0,
                flags: ['LIQUIDITY_CHECK_FAILED'],
                liquidityUsd: 0,
                isLpBurned: false,
                isLpLocked: false,
                lpRatioToMcap: 0
            };
        }
    }
    async checkLPTokenStatus(tokenAddress, pairData) {
        try {
            if (!pairData?.pairAddress) {
                return { isBurned: false, isLocked: false };
            }
            const burnAddresses = [
                '11111111111111111111111111111111',
                '1nc1nerator11111111111111111111111111111111',
                'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
            ];
            const lpHolders = await this.getLPHolders(pairData.pairAddress);
            let isBurned = false;
            let isLocked = false;
            for (const holder of lpHolders.slice(0, 5)) {
                if (burnAddresses.includes(holder.address)) {
                    if (holder.percentage > 80) {
                        isBurned = true;
                    }
                }
                else if (this.isKnownLockContract(holder.address)) {
                    if (holder.percentage > 80) {
                        isLocked = true;
                    }
                }
            }
            return { isBurned, isLocked };
        }
        catch (error) {
            logger_1.logger.error('Failed to check LP token status', error);
            return { isBurned: false, isLocked: false };
        }
    }
    async getLPHolders(pairAddress) {
        try {
            return [];
        }
        catch (error) {
            logger_1.logger.error('Failed to get LP holders', error);
            return [];
        }
    }
    isKnownLockContract(address) {
        const knownLockContracts = [
            'TeamTokenLockxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            'UncxLockxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
        ];
        return knownLockContracts.includes(address);
    }
    async checkLiquidityConcentration(tokenAddress) {
        try {
            const flags = [];
            let penalty = 0;
            return {
                isWellDistributed: true,
                flags,
                penalty
            };
        }
        catch (error) {
            return {
                isWellDistributed: false,
                flags: ['CONCENTRATION_CHECK_FAILED'],
                penalty: 10
            };
        }
    }
    async getLiquidityMetrics(tokenAddress) {
        try {
            return {
                totalLiquidity: 0,
                poolCount: 0,
                largestPool: 0,
                concentration: 0
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get liquidity metrics', error);
            return {
                totalLiquidity: 0,
                poolCount: 0,
                largestPool: 0,
                concentration: 0
            };
        }
    }
    async canSupportTrade(tokenAddress, tradeAmountUsd) {
        try {
            const check = await this.checkLiquidity(tokenAddress);
            return check.liquidityUsd >= tradeAmountUsd * 10;
        }
        catch (error) {
            logger_1.logger.error('Failed to check trade support', error);
            return false;
        }
    }
}
exports.LiquidityChecker = LiquidityChecker;

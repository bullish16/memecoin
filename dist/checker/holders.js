"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HolderChecker = void 0;
const solana_1 = require("../utils/solana");
const logger_1 = require("../utils/logger");
class HolderChecker {
    constructor() {
        this.knownDevWallets = new Set();
        this.bundledWalletPatterns = new Map();
    }
    async checkHolders(tokenAddress) {
        try {
            logger_1.logger.debug(`Checking holders for token: ${tokenAddress}`);
            const holders = await this.getTokenHolders(tokenAddress);
            const totalSupply = await this.getTotalSupply(tokenAddress);
            if (!holders || holders.length === 0) {
                return {
                    score: 0,
                    flags: ['NO_HOLDERS_DATA'],
                    totalHolders: 0,
                    top10Concentration: 100,
                    devWalletPct: 0,
                    bundledWallets: 0
                };
            }
            const flags = [];
            let score = 100;
            const stats = this.calculateHolderStats(holders, totalSupply);
            if (stats.totalHolders < 10) {
                flags.push('VERY_FEW_HOLDERS');
                score -= 40;
            }
            else if (stats.totalHolders < 50) {
                flags.push('FEW_HOLDERS');
                score -= 20;
            }
            else if (stats.totalHolders < 100) {
                flags.push('LIMITED_HOLDERS');
                score -= 10;
            }
            if (stats.top10Concentration > 90) {
                flags.push('EXTREME_CONCENTRATION');
                score -= 50;
                logger_1.logger.warning(`Extreme holder concentration: ${stats.top10Concentration}%`);
            }
            else if (stats.top10Concentration > 80) {
                flags.push('HIGH_CONCENTRATION');
                score -= 30;
            }
            else if (stats.top10Concentration > 70) {
                flags.push('MODERATE_CONCENTRATION');
                score -= 15;
            }
            const devWalletPct = await this.checkDevWalletConcentration(holders, tokenAddress);
            if (devWalletPct > 20) {
                flags.push('HIGH_DEV_CONCENTRATION');
                score -= 30;
                logger_1.logger.warning(`High dev wallet concentration: ${devWalletPct}%`);
            }
            else if (devWalletPct > 10) {
                flags.push('MODERATE_DEV_CONCENTRATION');
                score -= 15;
            }
            const bundledWallets = await this.detectBundledWallets(holders);
            if (bundledWallets > 10) {
                flags.push('MANY_BUNDLED_WALLETS');
                score -= 25;
            }
            else if (bundledWallets > 5) {
                flags.push('SOME_BUNDLED_WALLETS');
                score -= 10;
            }
            const suspiciousPatterns = this.detectSuspiciousPatterns(holders);
            if (suspiciousPatterns.length > 0) {
                flags.push(...suspiciousPatterns);
                score -= suspiciousPatterns.length * 10;
            }
            const result = {
                score: Math.max(0, score),
                flags,
                totalHolders: stats.totalHolders,
                top10Concentration: stats.top10Concentration,
                devWalletPct,
                bundledWallets
            };
            logger_1.logger.debug(`Holder check completed for ${tokenAddress}`, result);
            return result;
        }
        catch (error) {
            logger_1.logger.error(`Failed to check holders for ${tokenAddress}`, error);
            return {
                score: 0,
                flags: ['HOLDER_CHECK_FAILED'],
                totalHolders: 0,
                top10Concentration: 100,
                devWalletPct: 0,
                bundledWallets: 0
            };
        }
    }
    async getTokenHolders(tokenAddress) {
        try {
            const rawHolders = await solana_1.solanaUtils.getTokenHolders(tokenAddress);
            const totalSupply = await this.getTotalSupply(tokenAddress);
            if (!totalSupply || totalSupply === 0) {
                return [];
            }
            const holders = rawHolders
                .filter(holder => BigInt(holder.amount) > 0)
                .map(holder => {
                const balance = BigInt(holder.amount);
                const percentage = Number(balance) / totalSupply * 100;
                return {
                    address: holder.owner,
                    balance: holder.amount,
                    percentage: Math.round(percentage * 100) / 100
                };
            })
                .sort((a, b) => b.percentage - a.percentage);
            return holders;
        }
        catch (error) {
            logger_1.logger.error('Failed to get token holders', error);
            return [];
        }
    }
    async getTotalSupply(tokenAddress) {
        try {
            const mintInfo = await solana_1.solanaUtils.getMintInfo(tokenAddress);
            return mintInfo ? Number(mintInfo.supply) : 0;
        }
        catch (error) {
            logger_1.logger.error('Failed to get total supply', error);
            return 0;
        }
    }
    calculateHolderStats(holders, totalSupply) {
        const totalHolders = holders.length;
        const top10 = holders.slice(0, 10);
        const top10Concentration = top10.reduce((sum, holder) => sum + holder.percentage, 0);
        const sortedBalances = holders.map(h => h.percentage).sort((a, b) => a - b);
        const medianHolding = totalHolders > 0 ?
            sortedBalances[Math.floor(totalHolders / 2)] : 0;
        const averageHolding = totalHolders > 0 ?
            holders.reduce((sum, h) => sum + h.percentage, 0) / totalHolders : 0;
        return {
            totalHolders,
            top10Concentration: Math.round(top10Concentration * 100) / 100,
            medianHolding: Math.round(medianHolding * 100) / 100,
            averageHolding: Math.round(averageHolding * 100) / 100
        };
    }
    async checkDevWalletConcentration(holders, tokenAddress) {
        try {
            let devConcentration = 0;
            for (const holder of holders.slice(0, 20)) {
                if (await this.isPotentialDevWallet(holder.address, tokenAddress)) {
                    devConcentration += holder.percentage;
                    this.knownDevWallets.add(holder.address);
                }
            }
            return Math.round(devConcentration * 100) / 100;
        }
        catch (error) {
            logger_1.logger.error('Failed to check dev wallet concentration', error);
            return 0;
        }
    }
    async isPotentialDevWallet(walletAddress, tokenAddress) {
        try {
            if (this.knownDevWallets.has(walletAddress)) {
                return true;
            }
            return false;
        }
        catch (error) {
            return false;
        }
    }
    async detectBundledWallets(holders) {
        try {
            let bundledCount = 0;
            const checkedWallets = new Set();
            for (const holder of holders.slice(0, 50)) {
                if (checkedWallets.has(holder.address))
                    continue;
                const relatedWallets = await this.findRelatedWallets(holder.address, holders);
                if (relatedWallets.length > 1) {
                    bundledCount += relatedWallets.length;
                    relatedWallets.forEach(wallet => checkedWallets.add(wallet));
                }
            }
            return bundledCount;
        }
        catch (error) {
            logger_1.logger.error('Failed to detect bundled wallets', error);
            return 0;
        }
    }
    async findRelatedWallets(walletAddress, allHolders) {
        try {
            const relatedWallets = [walletAddress];
            const targetHolder = allHolders.find(h => h.address === walletAddress);
            if (!targetHolder)
                return relatedWallets;
            for (const holder of allHolders) {
                if (holder.address === walletAddress)
                    continue;
                const percentageDiff = Math.abs(holder.percentage - targetHolder.percentage);
                if (percentageDiff < 0.1 && holder.percentage > 0.5) {
                    relatedWallets.push(holder.address);
                }
            }
            return relatedWallets;
        }
        catch (error) {
            return [walletAddress];
        }
    }
    detectSuspiciousPatterns(holders) {
        const flags = [];
        try {
            const balanceGroups = new Map();
            holders.forEach(holder => {
                const rounded = Math.round(holder.percentage * 1000) / 1000;
                balanceGroups.set(rounded.toString(), (balanceGroups.get(rounded.toString()) || 0) + 1);
            });
            for (const [balance, count] of balanceGroups) {
                if (count > 10 && parseFloat(balance) > 0.1) {
                    flags.push('IDENTICAL_BALANCES_PATTERN');
                    break;
                }
            }
            if (holders.length > 0 && holders[0].percentage > 50) {
                flags.push('SINGLE_MAJORITY_HOLDER');
            }
            if (holders.length >= 3) {
                const top3 = holders.slice(0, 3).reduce((sum, h) => sum + h.percentage, 0);
                if (top3 > 80) {
                    flags.push('TOP3_SUPERMAJORITY');
                }
            }
            const smallHolders = holders.filter(h => h.percentage < 1 && h.percentage > 0.001);
            if (smallHolders.length > 100) {
                const avgSmallHolding = smallHolders.reduce((sum, h) => sum + h.percentage, 0) / smallHolders.length;
                const similarCount = smallHolders.filter(h => Math.abs(h.percentage - avgSmallHolding) < avgSmallHolding * 0.1).length;
                if (similarCount > 50) {
                    flags.push('ARTIFICIAL_SMALL_HOLDERS');
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to detect suspicious patterns', error);
        }
        return flags;
    }
    async getHolderAnalysis(tokenAddress) {
        try {
            const holders = await this.getTokenHolders(tokenAddress);
            if (holders.length === 0) {
                return {
                    totalHolders: 0,
                    distribution: [],
                    topHolders: [],
                    concentration: { top1: 0, top5: 0, top10: 0, top20: 0 }
                };
            }
            const distribution = this.calculateDistribution(holders);
            const concentration = {
                top1: holders.slice(0, 1).reduce((sum, h) => sum + h.percentage, 0),
                top5: holders.slice(0, 5).reduce((sum, h) => sum + h.percentage, 0),
                top10: holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0),
                top20: holders.slice(0, 20).reduce((sum, h) => sum + h.percentage, 0)
            };
            return {
                totalHolders: holders.length,
                distribution,
                topHolders: holders.slice(0, 10),
                concentration
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get holder analysis', error);
            return {
                totalHolders: 0,
                distribution: [],
                topHolders: [],
                concentration: { top1: 0, top5: 0, top10: 0, top20: 0 }
            };
        }
    }
    calculateDistribution(holders) {
        const ranges = [
            { min: 10, max: Infinity, label: '>10%' },
            { min: 5, max: 10, label: '5-10%' },
            { min: 1, max: 5, label: '1-5%' },
            { min: 0.1, max: 1, label: '0.1-1%' },
            { min: 0.01, max: 0.1, label: '0.01-0.1%' },
            { min: 0, max: 0.01, label: '<0.01%' }
        ];
        return ranges.map(range => {
            const count = holders.filter(h => h.percentage > range.min && h.percentage <= range.max).length;
            return {
                range: range.label,
                count,
                percentage: holders.length > 0 ? (count / holders.length) * 100 : 0
            };
        });
    }
}
exports.HolderChecker = HolderChecker;

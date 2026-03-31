"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskManager = void 0;
const config_1 = require("../config");
const solana_1 = require("../utils/solana");
const logger_1 = require("../utils/logger");
class RiskManager {
    constructor() {
        this.dailyStartBalance = 0;
        this.dailyLoss = 0;
        this.dailyResetDate = '';
        this.consecutiveLosses = 0;
        this.cooldownUntil = 0;
    }
    async initialize() {
        this.dailyStartBalance = await solana_1.solanaUtils.getWalletBalance();
        this.dailyResetDate = new Date().toISOString().slice(0, 10);
        logger_1.logger.info(`Risk manager initialized. Starting balance: ${this.dailyStartBalance} SOL`);
    }
    async canOpenPosition(positions) {
        const today = new Date().toISOString().slice(0, 10);
        if (today !== this.dailyResetDate) {
            this.dailyLoss = 0;
            this.consecutiveLosses = 0;
            this.dailyStartBalance = await solana_1.solanaUtils.getWalletBalance();
            this.dailyResetDate = today;
            logger_1.logger.info('Daily risk counters reset');
        }
        if (Date.now() < this.cooldownUntil) {
            const remaining = Math.ceil((this.cooldownUntil - Date.now()) / 60000);
            return { allowed: false, reason: `Cooldown active: ${remaining} minutes remaining` };
        }
        const openPositions = positions.filter(p => p.status === 'OPEN');
        if (openPositions.length >= config_1.config.maxPositions) {
            return { allowed: false, reason: `Max positions reached: ${openPositions.length}/${config_1.config.maxPositions}` };
        }
        const dailyLossPct = this.dailyStartBalance > 0
            ? (this.dailyLoss / this.dailyStartBalance) * 100
            : 0;
        if (dailyLossPct >= config_1.config.maxDailyLossPct) {
            return { allowed: false, reason: `Daily loss limit reached: ${dailyLossPct.toFixed(1)}% >= ${config_1.config.maxDailyLossPct}%` };
        }
        const balance = await solana_1.solanaUtils.getWalletBalance();
        const minReserve = 0.01;
        if (balance < config_1.config.buyAmountSol + minReserve) {
            return { allowed: false, reason: `Insufficient balance: ${balance.toFixed(4)} SOL (need ${(config_1.config.buyAmountSol + minReserve).toFixed(4)} SOL)` };
        }
        if (this.consecutiveLosses >= 3) {
            this.cooldownUntil = Date.now() + 15 * 60 * 1000;
            this.consecutiveLosses = 0;
            return { allowed: false, reason: '3 consecutive losses — 15 minute cooldown activated' };
        }
        return { allowed: true, reason: 'All checks passed' };
    }
    calculatePositionSize(walletBalance) {
        const maxFromWallet = walletBalance * 0.30;
        const buyAmount = Math.min(config_1.config.buyAmountSol, maxFromWallet);
        const maxAfterReserve = walletBalance - 0.01;
        return Math.max(0, Math.min(buyAmount, maxAfterReserve));
    }
    shouldTakeProfit(position) {
        const pnlMultiple = position.currentPrice / position.entryPrice;
        if (pnlMultiple >= 10) {
            return {
                action: 'partial_sell',
                percentage: config_1.config.takeProfitLevels['10x'] * 100,
                reason: `🚀 10x reached! Selling ${config_1.config.takeProfitLevels['10x'] * 100}%`,
            };
        }
        if (pnlMultiple >= 5) {
            return {
                action: 'partial_sell',
                percentage: config_1.config.takeProfitLevels['5x'] * 100,
                reason: `🔥 5x reached! Selling ${config_1.config.takeProfitLevels['5x'] * 100}%`,
            };
        }
        if (pnlMultiple >= 2) {
            return {
                action: 'partial_sell',
                percentage: config_1.config.takeProfitLevels['2x'] * 100,
                reason: `💰 2x reached! Selling ${config_1.config.takeProfitLevels['2x'] * 100}%`,
            };
        }
        return { action: 'hold', percentage: 0, reason: 'Holding position' };
    }
    shouldStopLoss(position) {
        const lossPct = ((position.entryPrice - position.currentPrice) / position.entryPrice) * 100;
        return lossPct >= config_1.config.stopLossPct;
    }
    recordTradeResult(trade, pnlSol) {
        if (pnlSol < 0) {
            this.dailyLoss += Math.abs(pnlSol);
            this.consecutiveLosses++;
            logger_1.logger.risk(`Loss recorded: ${pnlSol.toFixed(4)} SOL | Consecutive losses: ${this.consecutiveLosses}`);
        }
        else {
            this.consecutiveLosses = 0;
        }
    }
    getStatus() {
        const dailyLossPct = this.dailyStartBalance > 0
            ? (this.dailyLoss / this.dailyStartBalance) * 100
            : 0;
        return {
            dailyLoss: this.dailyLoss,
            dailyLossPct,
            consecutiveLosses: this.consecutiveLosses,
            cooldownActive: Date.now() < this.cooldownUntil,
            cooldownRemaining: Math.max(0, Math.ceil((this.cooldownUntil - Date.now()) / 60000)),
        };
    }
}
exports.RiskManager = RiskManager;

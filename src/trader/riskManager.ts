import { Position, Trade } from '../types';
import { config } from '../config';
import { solanaUtils } from '../utils/solana';
import { logger } from '../utils/logger';

export class RiskManager {
  private dailyStartBalance: number = 0;
  private dailyLoss: number = 0;
  private dailyResetDate: string = '';
  private consecutiveLosses: number = 0;
  private cooldownUntil: number = 0;

  async initialize(): Promise<void> {
    this.dailyStartBalance = await solanaUtils.getWalletBalance();
    this.dailyResetDate = new Date().toISOString().slice(0, 10);
    logger.info(`Risk manager initialized. Starting balance: ${this.dailyStartBalance} SOL`);
  }

  async canOpenPosition(positions: Position[]): Promise<{ allowed: boolean; reason: string }> {
    // Reset daily counters if new day
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyResetDate) {
      this.dailyLoss = 0;
      this.consecutiveLosses = 0;
      this.dailyStartBalance = await solanaUtils.getWalletBalance();
      this.dailyResetDate = today;
      logger.info('Daily risk counters reset');
    }

    // Check cooldown
    if (Date.now() < this.cooldownUntil) {
      const remaining = Math.ceil((this.cooldownUntil - Date.now()) / 60000);
      return { allowed: false, reason: `Cooldown active: ${remaining} minutes remaining` };
    }

    // Check max concurrent positions
    const openPositions = positions.filter(p => p.status === 'OPEN');
    if (openPositions.length >= config.maxPositions) {
      return { allowed: false, reason: `Max positions reached: ${openPositions.length}/${config.maxPositions}` };
    }

    // Check daily loss limit
    const dailyLossPct = this.dailyStartBalance > 0
      ? (this.dailyLoss / this.dailyStartBalance) * 100
      : 0;
    if (dailyLossPct >= config.maxDailyLossPct) {
      return { allowed: false, reason: `Daily loss limit reached: ${dailyLossPct.toFixed(1)}% >= ${config.maxDailyLossPct}%` };
    }

    // Check minimum wallet balance (reserve for gas)
    const balance = await solanaUtils.getWalletBalance();
    const minReserve = 0.01;
    if (balance < config.buyAmountSol + minReserve) {
      return { allowed: false, reason: `Insufficient balance: ${balance.toFixed(4)} SOL (need ${(config.buyAmountSol + minReserve).toFixed(4)} SOL)` };
    }

    // Check consecutive losses → cooldown
    if (this.consecutiveLosses >= 3) {
      this.cooldownUntil = Date.now() + 15 * 60 * 1000; // 15 min cooldown
      this.consecutiveLosses = 0;
      return { allowed: false, reason: '3 consecutive losses — 15 minute cooldown activated' };
    }

    return { allowed: true, reason: 'All checks passed' };
  }

  calculatePositionSize(walletBalance: number): number {
    // Never more than 30% of wallet on a single trade
    const maxFromWallet = walletBalance * 0.30;
    const buyAmount = Math.min(config.buyAmountSol, maxFromWallet);

    // Keep at least 0.01 SOL for gas
    const maxAfterReserve = walletBalance - 0.01;
    return Math.max(0, Math.min(buyAmount, maxAfterReserve));
  }

  shouldTakeProfit(position: Position): { action: 'hold' | 'partial_sell' | 'full_sell'; percentage: number; reason: string } {
    const pnlMultiple = position.currentPrice / position.entryPrice;

    // Take profit levels
    if (pnlMultiple >= 10) {
      return {
        action: 'partial_sell',
        percentage: config.takeProfitLevels['10x'] * 100,
        reason: `🚀 10x reached! Selling ${config.takeProfitLevels['10x'] * 100}%`,
      };
    }
    if (pnlMultiple >= 5) {
      return {
        action: 'partial_sell',
        percentage: config.takeProfitLevels['5x'] * 100,
        reason: `🔥 5x reached! Selling ${config.takeProfitLevels['5x'] * 100}%`,
      };
    }
    if (pnlMultiple >= 2) {
      return {
        action: 'partial_sell',
        percentage: config.takeProfitLevels['2x'] * 100,
        reason: `💰 2x reached! Selling ${config.takeProfitLevels['2x'] * 100}%`,
      };
    }

    return { action: 'hold', percentage: 0, reason: 'Holding position' };
  }

  shouldStopLoss(position: Position): boolean {
    const lossPct = ((position.entryPrice - position.currentPrice) / position.entryPrice) * 100;
    return lossPct >= config.stopLossPct;
  }

  recordTradeResult(trade: Trade, pnlSol: number): void {
    if (pnlSol < 0) {
      this.dailyLoss += Math.abs(pnlSol);
      this.consecutiveLosses++;
      logger.risk(`Loss recorded: ${pnlSol.toFixed(4)} SOL | Consecutive losses: ${this.consecutiveLosses}`);
    } else {
      this.consecutiveLosses = 0;
    }
  }

  getStatus(): {
    dailyLoss: number;
    dailyLossPct: number;
    consecutiveLosses: number;
    cooldownActive: boolean;
    cooldownRemaining: number;
  } {
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

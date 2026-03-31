import { JupiterClient } from './jupiter';
import { RiskManager } from './riskManager';
import { Position, Trade, TokenPair, TokenScore } from '../types';
import { config } from '../config';
import { solanaUtils } from '../utils/solana';
import { logger } from '../utils/logger';
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export class TradeExecutor {
  private jupiter: JupiterClient;
  private riskManager: RiskManager;
  private positions: Position[] = [];
  private tradeHistory: Trade[] = [];
  private priceCheckInterval?: NodeJS.Timeout;

  constructor() {
    this.jupiter = new JupiterClient();
    this.riskManager = new RiskManager();
  }

  async initialize(): Promise<void> {
    await this.riskManager.initialize();
    this.startPriceMonitor();
    logger.success('Trade executor initialized');
  }

  async executeBuy(tokenAddress: string, tokenSymbol: string, pair: TokenPair): Promise<Position | null> {
    try {
      // Check risk management
      const riskCheck = await this.riskManager.canOpenPosition(this.positions);
      if (!riskCheck.allowed) {
        logger.warning(`Trade blocked by risk manager: ${riskCheck.reason}`);
        return null;
      }

      // Calculate position size
      const balance = await solanaUtils.getWalletBalance();
      const buyAmount = this.riskManager.calculatePositionSize(balance);

      if (buyAmount <= 0) {
        logger.warning('Position size is 0 — skipping');
        return null;
      }

      logger.trade(`Buying ${tokenSymbol} for ${buyAmount.toFixed(4)} SOL...`);

      // Execute buy via Jupiter
      const result = await this.jupiter.buyToken(tokenAddress, buyAmount);
      if (!result) {
        logger.error(`Buy failed for ${tokenSymbol}`);
        return null;
      }

      const priceUsd = parseFloat(pair.priceUsd || '0');

      // Create position
      const position: Position = {
        id: genId(),
        tokenAddress,
        tokenSymbol,
        entryPrice: priceUsd,
        currentPrice: priceUsd,
        amount: parseFloat(result.amountOut),
        solInvested: buyAmount,
        pnl: 0,
        pnlPercent: 0,
        timestamp: Date.now(),
        status: 'OPEN',
      };

      this.positions.push(position);

      // Record trade
      const trade: Trade = {
        id: genId(),
        type: 'BUY',
        tokenAddress,
        tokenSymbol,
        price: priceUsd,
        amount: parseFloat(result.amountOut),
        solAmount: buyAmount,
        timestamp: Date.now(),
        txHash: result.txHash,
        reason: 'Signal from scoring engine',
      };

      this.tradeHistory.push(trade);

      logger.success(`✅ Bought ${tokenSymbol} | ${buyAmount.toFixed(4)} SOL | Tx: ${result.txHash}`);
      return position;
    } catch (error) {
      logger.error(`Buy execution failed for ${tokenAddress}`, error);
      return null;
    }
  }

  async executeSell(positionId: string, percentage: number, reason: string): Promise<Trade | null> {
    try {
      const position = this.positions.find(p => p.id === positionId);
      if (!position || position.status !== 'OPEN') {
        logger.warning(`Position ${positionId} not found or already closed`);
        return null;
      }

      const sellAmount = position.amount * (percentage / 100);

      logger.trade(`Selling ${percentage}% of ${position.tokenSymbol} (${reason})...`);

      const result = await this.jupiter.sellToken(
        position.tokenAddress,
        sellAmount
      );

      if (!result) {
        logger.error(`Sell failed for ${position.tokenSymbol}`);
        return null;
      }

      const solReceived = solanaUtils.lamportsToSol(parseInt(result.solOut));

      // Update position
      position.amount -= sellAmount;
      if (position.amount <= 0 || percentage >= 100) {
        position.status = 'CLOSED';
      }

      // Calculate PnL for this sell
      const costBasis = position.solInvested * (percentage / 100);
      const pnlSol = solReceived - costBasis;

      // Record trade result for risk management
      this.riskManager.recordTradeResult(
        { id: genId(), type: 'SELL', tokenAddress: position.tokenAddress, tokenSymbol: position.tokenSymbol, price: position.currentPrice, amount: sellAmount, solAmount: solReceived, timestamp: Date.now() },
        pnlSol
      );

      const trade: Trade = {
        id: genId(),
        type: 'SELL',
        tokenAddress: position.tokenAddress,
        tokenSymbol: position.tokenSymbol,
        price: position.currentPrice,
        amount: sellAmount,
        solAmount: solReceived,
        timestamp: Date.now(),
        txHash: result.txHash,
        reason,
      };

      this.tradeHistory.push(trade);

      const pnlEmoji = pnlSol >= 0 ? '💰' : '📉';
      logger.trade(`${pnlEmoji} Sold ${percentage}% of ${position.tokenSymbol} | ${solReceived.toFixed(4)} SOL | PnL: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL | Reason: ${reason}`);

      return trade;
    } catch (error) {
      logger.error(`Sell execution failed for position ${positionId}`, error);
      return null;
    }
  }

  private startPriceMonitor(): void {
    // Check prices every 15 seconds
    this.priceCheckInterval = setInterval(async () => {
      await this.updatePositionsAndCheck();
    }, 15000);
  }

  private async updatePositionsAndCheck(): Promise<void> {
    const openPositions = this.positions.filter(p => p.status === 'OPEN');
    if (openPositions.length === 0) return;

    for (const position of openPositions) {
      try {
        // Get current price
        const { DexScreenerAPI } = await import('../scanner/dexscreener');
        const dex = new DexScreenerAPI();
        const price = await dex.getTokenPrice(position.tokenAddress);

        if (price === null) continue;

        position.currentPrice = price;
        position.pnl = ((price - position.entryPrice) / position.entryPrice) * position.solInvested;
        position.pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;

        // Check stop-loss
        if (this.riskManager.shouldStopLoss(position)) {
          logger.risk(`🛑 Stop-loss triggered for ${position.tokenSymbol} (${position.pnlPercent.toFixed(1)}%)`);
          await this.executeSell(position.id, 100, `Stop-loss: ${position.pnlPercent.toFixed(1)}%`);
          continue;
        }

        // Check take-profit
        const tpDecision = this.riskManager.shouldTakeProfit(position);
        if (tpDecision.action !== 'hold') {
          logger.trade(`${tpDecision.reason}`);
          await this.executeSell(position.id, tpDecision.percentage, tpDecision.reason);
        }
      } catch (error) {
        logger.error(`Price check failed for ${position.tokenSymbol}`, error);
      }
    }
  }

  getPositions(): Position[] {
    return [...this.positions];
  }

  getOpenPositions(): Position[] {
    return this.positions.filter(p => p.status === 'OPEN');
  }

  getTradeHistory(): Trade[] {
    return [...this.tradeHistory];
  }

  getRiskStatus() {
    return this.riskManager.getStatus();
  }

  getStats(): {
    totalTrades: number;
    winRate: number;
    totalPnlSol: number;
    avgReturn: number;
  } {
    const sells = this.tradeHistory.filter(t => t.type === 'SELL');
    if (sells.length === 0) {
      return { totalTrades: 0, winRate: 0, totalPnlSol: 0, avgReturn: 0 };
    }

    let wins = 0;
    let totalPnl = 0;

    // Match sells to buys for PnL calculation
    const closedPositions = this.positions.filter(p => p.status === 'CLOSED');
    for (const pos of closedPositions) {
      const positionPnl = pos.pnl;
      totalPnl += positionPnl;
      if (positionPnl > 0) wins++;
    }

    return {
      totalTrades: sells.length,
      winRate: sells.length > 0 ? (wins / closedPositions.length) * 100 : 0,
      totalPnlSol: totalPnl,
      avgReturn: closedPositions.length > 0 ? totalPnl / closedPositions.length : 0,
    };
  }

  stop(): void {
    if (this.priceCheckInterval) {
      clearInterval(this.priceCheckInterval);
    }
    logger.info('Trade executor stopped');
  }
}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradeExecutor = void 0;
const jupiter_1 = require("./jupiter");
const riskManager_1 = require("./riskManager");
const solana_1 = require("../utils/solana");
const logger_1 = require("../utils/logger");
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
class TradeExecutor {
    constructor() {
        this.positions = [];
        this.tradeHistory = [];
        this.jupiter = new jupiter_1.JupiterClient();
        this.riskManager = new riskManager_1.RiskManager();
    }
    async initialize() {
        await this.riskManager.initialize();
        this.startPriceMonitor();
        logger_1.logger.success('Trade executor initialized');
    }
    async executeBuy(tokenAddress, tokenSymbol, pair) {
        try {
            const riskCheck = await this.riskManager.canOpenPosition(this.positions);
            if (!riskCheck.allowed) {
                logger_1.logger.warning(`Trade blocked by risk manager: ${riskCheck.reason}`);
                return null;
            }
            const balance = await solana_1.solanaUtils.getWalletBalance();
            const buyAmount = this.riskManager.calculatePositionSize(balance);
            if (buyAmount <= 0) {
                logger_1.logger.warning('Position size is 0 — skipping');
                return null;
            }
            logger_1.logger.trade(`Buying ${tokenSymbol} for ${buyAmount.toFixed(4)} SOL...`);
            const result = await this.jupiter.buyToken(tokenAddress, buyAmount);
            if (!result) {
                logger_1.logger.error(`Buy failed for ${tokenSymbol}`);
                return null;
            }
            const priceUsd = parseFloat(pair.priceUsd || '0');
            const position = {
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
            const trade = {
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
            logger_1.logger.success(`✅ Bought ${tokenSymbol} | ${buyAmount.toFixed(4)} SOL | Tx: ${result.txHash}`);
            return position;
        }
        catch (error) {
            logger_1.logger.error(`Buy execution failed for ${tokenAddress}`, error);
            return null;
        }
    }
    async executeSell(positionId, percentage, reason) {
        try {
            const position = this.positions.find(p => p.id === positionId);
            if (!position || position.status !== 'OPEN') {
                logger_1.logger.warning(`Position ${positionId} not found or already closed`);
                return null;
            }
            const sellAmount = position.amount * (percentage / 100);
            logger_1.logger.trade(`Selling ${percentage}% of ${position.tokenSymbol} (${reason})...`);
            const result = await this.jupiter.sellToken(position.tokenAddress, sellAmount);
            if (!result) {
                logger_1.logger.error(`Sell failed for ${position.tokenSymbol}`);
                return null;
            }
            const solReceived = solana_1.solanaUtils.lamportsToSol(parseInt(result.solOut));
            position.amount -= sellAmount;
            if (position.amount <= 0 || percentage >= 100) {
                position.status = 'CLOSED';
            }
            const costBasis = position.solInvested * (percentage / 100);
            const pnlSol = solReceived - costBasis;
            this.riskManager.recordTradeResult({ id: genId(), type: 'SELL', tokenAddress: position.tokenAddress, tokenSymbol: position.tokenSymbol, price: position.currentPrice, amount: sellAmount, solAmount: solReceived, timestamp: Date.now() }, pnlSol);
            const trade = {
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
            logger_1.logger.trade(`${pnlEmoji} Sold ${percentage}% of ${position.tokenSymbol} | ${solReceived.toFixed(4)} SOL | PnL: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL | Reason: ${reason}`);
            return trade;
        }
        catch (error) {
            logger_1.logger.error(`Sell execution failed for position ${positionId}`, error);
            return null;
        }
    }
    startPriceMonitor() {
        this.priceCheckInterval = setInterval(async () => {
            await this.updatePositionsAndCheck();
        }, 15000);
    }
    async updatePositionsAndCheck() {
        const openPositions = this.positions.filter(p => p.status === 'OPEN');
        if (openPositions.length === 0)
            return;
        for (const position of openPositions) {
            try {
                const { DexScreenerAPI } = await Promise.resolve().then(() => __importStar(require('../scanner/dexscreener')));
                const dex = new DexScreenerAPI();
                const price = await dex.getTokenPrice(position.tokenAddress);
                if (price === null)
                    continue;
                position.currentPrice = price;
                position.pnl = ((price - position.entryPrice) / position.entryPrice) * position.solInvested;
                position.pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;
                if (this.riskManager.shouldStopLoss(position)) {
                    logger_1.logger.risk(`🛑 Stop-loss triggered for ${position.tokenSymbol} (${position.pnlPercent.toFixed(1)}%)`);
                    await this.executeSell(position.id, 100, `Stop-loss: ${position.pnlPercent.toFixed(1)}%`);
                    continue;
                }
                const tpDecision = this.riskManager.shouldTakeProfit(position);
                if (tpDecision.action !== 'hold') {
                    logger_1.logger.trade(`${tpDecision.reason}`);
                    await this.executeSell(position.id, tpDecision.percentage, tpDecision.reason);
                }
            }
            catch (error) {
                logger_1.logger.error(`Price check failed for ${position.tokenSymbol}`, error);
            }
        }
    }
    getPositions() {
        return [...this.positions];
    }
    getOpenPositions() {
        return this.positions.filter(p => p.status === 'OPEN');
    }
    getTradeHistory() {
        return [...this.tradeHistory];
    }
    getRiskStatus() {
        return this.riskManager.getStatus();
    }
    getStats() {
        const sells = this.tradeHistory.filter(t => t.type === 'SELL');
        if (sells.length === 0) {
            return { totalTrades: 0, winRate: 0, totalPnlSol: 0, avgReturn: 0 };
        }
        let wins = 0;
        let totalPnl = 0;
        const closedPositions = this.positions.filter(p => p.status === 'CLOSED');
        for (const pos of closedPositions) {
            const positionPnl = pos.pnl;
            totalPnl += positionPnl;
            if (positionPnl > 0)
                wins++;
        }
        return {
            totalTrades: sells.length,
            winRate: sells.length > 0 ? (wins / closedPositions.length) * 100 : 0,
            totalPnlSol: totalPnl,
            avgReturn: closedPositions.length > 0 ? totalPnl / closedPositions.length : 0,
        };
    }
    stop() {
        if (this.priceCheckInterval) {
            clearInterval(this.priceCheckInterval);
        }
        logger_1.logger.info('Trade executor stopped');
    }
}
exports.TradeExecutor = TradeExecutor;

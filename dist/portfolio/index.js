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
exports.PortfolioTracker = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
const DATA_DIR = path.join(process.cwd(), 'data');
const TRADES_FILE = path.join(DATA_DIR, 'trades.json');
const POSITIONS_FILE = path.join(DATA_DIR, 'positions.json');
class PortfolioTracker {
    constructor() {
        this.trades = [];
        this.positions = [];
        this.ensureDataDir();
        this.loadFromDisk();
    }
    ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    }
    loadFromDisk() {
        try {
            if (fs.existsSync(TRADES_FILE)) {
                this.trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf-8'));
                logger_1.logger.info(`Loaded ${this.trades.length} trades from disk`);
            }
            if (fs.existsSync(POSITIONS_FILE)) {
                this.positions = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf-8'));
                logger_1.logger.info(`Loaded ${this.positions.length} positions from disk`);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to load portfolio data', error);
        }
    }
    saveToDisk() {
        try {
            fs.writeFileSync(TRADES_FILE, JSON.stringify(this.trades, null, 2));
            fs.writeFileSync(POSITIONS_FILE, JSON.stringify(this.positions, null, 2));
        }
        catch (error) {
            logger_1.logger.error('Failed to save portfolio data', error);
        }
    }
    recordTrade(trade) {
        this.trades.push(trade);
        this.saveToDisk();
    }
    updatePosition(position) {
        const idx = this.positions.findIndex(p => p.id === position.id);
        if (idx >= 0) {
            this.positions[idx] = position;
        }
        else {
            this.positions.push(position);
        }
        this.saveToDisk();
    }
    syncFromExecutor(positions, trades) {
        this.positions = positions;
        this.trades = trades;
        this.saveToDisk();
    }
    getOpenPositions() {
        return this.positions.filter(p => p.status === 'OPEN');
    }
    getClosedPositions() {
        return this.positions.filter(p => p.status === 'CLOSED');
    }
    getAllTrades() {
        return [...this.trades];
    }
    getRecentTrades(limit = 10) {
        return this.trades.slice(-limit);
    }
    getSummaryStats() {
        const buys = this.trades.filter(t => t.type === 'BUY');
        const sells = this.trades.filter(t => t.type === 'SELL');
        const closed = this.getClosedPositions();
        const open = this.getOpenPositions();
        const wins = closed.filter(p => p.pnl > 0);
        const losses = closed.filter(p => p.pnl <= 0);
        const totalPnl = closed.reduce((sum, p) => sum + p.pnl, 0);
        const totalInvested = buys.reduce((sum, t) => sum + t.solAmount, 0);
        const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + p.pnl, 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((s, p) => s + p.pnl, 0) / losses.length : 0;
        const grossWin = wins.reduce((s, p) => s + p.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, p) => s + p.pnl, 0));
        return {
            totalTrades: this.trades.length,
            totalBuys: buys.length,
            totalSells: sells.length,
            openPositions: open.length,
            closedPositions: closed.length,
            winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
            totalPnlSol: totalPnl,
            totalInvested,
            avgWin,
            avgLoss,
            bestTrade: closed.length > 0 ? Math.max(...closed.map(p => p.pnl)) : 0,
            worstTrade: closed.length > 0 ? Math.min(...closed.map(p => p.pnl)) : 0,
            profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
        };
    }
    getTodayStats() {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const ts = todayStart.getTime();
        const todayTrades = this.trades.filter(t => t.timestamp >= ts);
        const todayClosed = this.positions.filter(p => p.status === 'CLOSED' && p.timestamp >= ts);
        return {
            trades: todayTrades.length,
            pnl: todayClosed.reduce((s, p) => s + p.pnl, 0),
            wins: todayClosed.filter(p => p.pnl > 0).length,
            losses: todayClosed.filter(p => p.pnl <= 0).length,
        };
    }
    formatSummary() {
        const stats = this.getSummaryStats();
        const today = this.getTodayStats();
        return [
            '╔══════════════════════════════════╗',
            '║       PORTFOLIO SUMMARY          ║',
            '╠══════════════════════════════════╣',
            `║ Total Trades:    ${String(stats.totalTrades).padStart(14)} ║`,
            `║ Open Positions:  ${String(stats.openPositions).padStart(14)} ║`,
            `║ Win Rate:        ${(stats.winRate.toFixed(1) + '%').padStart(14)} ║`,
            `║ Total PnL:       ${(stats.totalPnlSol.toFixed(4) + ' SOL').padStart(14)} ║`,
            `║ Best Trade:      ${(stats.bestTrade.toFixed(4) + ' SOL').padStart(14)} ║`,
            `║ Worst Trade:     ${(stats.worstTrade.toFixed(4) + ' SOL').padStart(14)} ║`,
            `║ Profit Factor:   ${stats.profitFactor === Infinity ? '∞'.padStart(14) : stats.profitFactor.toFixed(2).padStart(14)} ║`,
            '╠══════════════════════════════════╣',
            '║          TODAY                   ║',
            `║ Trades:          ${String(today.trades).padStart(14)} ║`,
            `║ PnL:             ${(today.pnl.toFixed(4) + ' SOL').padStart(14)} ║`,
            `║ W/L:             ${(today.wins + '/' + today.losses).padStart(14)} ║`,
            '╚══════════════════════════════════╝',
        ].join('\n');
    }
}
exports.PortfolioTracker = PortfolioTracker;

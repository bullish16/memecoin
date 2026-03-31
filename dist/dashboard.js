"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Dashboard = void 0;
const chalk_1 = __importDefault(require("chalk"));
const solana_1 = require("./utils/solana");
class Dashboard {
    start(getPositions, getTrades, getRiskStatus, getScannerStatus, getPortfolioSummary) {
        this.refreshInterval = setInterval(async () => {
            await this.render(getPositions, getTrades, getRiskStatus, getScannerStatus, getPortfolioSummary);
        }, 10000);
        this.render(getPositions, getTrades, getRiskStatus, getScannerStatus, getPortfolioSummary);
    }
    stop() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
    }
    async render(getPositions, getTrades, getRiskStatus, getScannerStatus, getPortfolioSummary) {
        try {
            const balance = await solana_1.solanaUtils.getWalletBalance();
            const positions = getPositions();
            const trades = getTrades();
            const riskStatus = getRiskStatus();
            const scannerStatus = getScannerStatus();
            process.stdout.write('\x1B[2J\x1B[0f');
            const lines = [];
            lines.push(chalk_1.default.cyan.bold('╔══════════════════════════════════════════════════════════════╗'));
            lines.push(chalk_1.default.cyan.bold('║          🤖 SOLANA MEMECOIN TRADING BOT                     ║'));
            lines.push(chalk_1.default.cyan.bold('╠══════════════════════════════════════════════════════════════╣'));
            const modeColor = process.env.MODE === 'live' ? chalk_1.default.red.bold : chalk_1.default.green.bold;
            lines.push(chalk_1.default.white(`  Mode: ${modeColor(process.env.MODE?.toUpperCase() || 'PAPER')}  |  Wallet: ${chalk_1.default.yellow(balance.toFixed(4))} SOL  |  Address: ${chalk_1.default.gray(solana_1.solanaUtils.getWalletAddress().toString().slice(0, 8))}...`));
            lines.push('');
            lines.push(chalk_1.default.magenta.bold('  📡 Scanner'));
            lines.push(chalk_1.default.white(`     Status: ${scannerStatus.isRunning ? chalk_1.default.green('RUNNING') : chalk_1.default.red('STOPPED')}  |  Tokens Seen: ${scannerStatus.seenTokensCount}`));
            lines.push('');
            lines.push(chalk_1.default.red.bold('  🛡️ Risk Manager'));
            const riskColor = riskStatus.cooldownActive ? chalk_1.default.red : chalk_1.default.green;
            lines.push(chalk_1.default.white(`     Daily Loss: ${chalk_1.default.yellow(riskStatus.dailyLossPct.toFixed(1))}%  |  Consecutive Losses: ${riskStatus.consecutiveLosses}  |  Cooldown: ${riskColor(riskStatus.cooldownActive ? `${riskStatus.cooldownRemaining}m` : 'OFF')}`));
            lines.push('');
            const openPositions = positions.filter(p => p.status === 'OPEN');
            lines.push(chalk_1.default.yellow.bold(`  📊 Active Positions (${openPositions.length}/${process.env.MAX_POSITIONS || 3})`));
            if (openPositions.length === 0) {
                lines.push(chalk_1.default.gray('     No open positions'));
            }
            else {
                lines.push(chalk_1.default.gray('     Symbol        Entry         Current       PnL          Age'));
                lines.push(chalk_1.default.gray('     ────────────  ──────────    ──────────    ─────────    ──────'));
                for (const pos of openPositions) {
                    const pnlColor = pos.pnlPercent >= 0 ? chalk_1.default.green : chalk_1.default.red;
                    const pnlStr = `${pos.pnlPercent >= 0 ? '+' : ''}${pos.pnlPercent.toFixed(1)}%`;
                    const ageMin = Math.floor((Date.now() - pos.timestamp) / 60000);
                    const ageStr = ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h${ageMin % 60}m`;
                    lines.push(`     ${chalk_1.default.white(pos.tokenSymbol.padEnd(12))}  $${pos.entryPrice.toFixed(8).padEnd(12)}  $${pos.currentPrice.toFixed(8).padEnd(12)}  ${pnlColor(pnlStr.padEnd(12))}  ${ageStr}`);
                }
            }
            lines.push('');
            const recentTrades = trades.slice(-5);
            lines.push(chalk_1.default.cyan.bold(`  📜 Recent Trades (last ${recentTrades.length})`));
            if (recentTrades.length === 0) {
                lines.push(chalk_1.default.gray('     No trades yet'));
            }
            else {
                lines.push(chalk_1.default.gray('     Type    Symbol        SOL           Tx              Time'));
                lines.push(chalk_1.default.gray('     ────    ──────────    ──────────    ──────────      ──────'));
                for (const trade of recentTrades.reverse()) {
                    const typeColor = trade.type === 'BUY' ? chalk_1.default.green : chalk_1.default.red;
                    const timeStr = new Date(trade.timestamp).toLocaleTimeString();
                    const txShort = trade.txHash ? trade.txHash.slice(0, 10) + '...' : 'N/A';
                    lines.push(`     ${typeColor(trade.type.padEnd(6))}  ${chalk_1.default.white(trade.tokenSymbol.padEnd(12))}  ${trade.solAmount.toFixed(4).padEnd(12)}  ${chalk_1.default.gray(txShort.padEnd(14))}  ${timeStr}`);
                }
            }
            lines.push('');
            lines.push(chalk_1.default.cyan.bold('╚══════════════════════════════════════════════════════════════╝'));
            lines.push(chalk_1.default.gray(`  Last updated: ${new Date().toLocaleTimeString()}  |  Press Ctrl+C to stop`));
            console.log(lines.join('\n'));
        }
        catch (error) {
        }
    }
}
exports.Dashboard = Dashboard;

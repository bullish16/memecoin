import chalk from 'chalk';
import { Position, Trade } from './types';
import { solanaUtils } from './utils/solana';
import { logger } from './utils/logger';

export class Dashboard {
  private refreshInterval?: NodeJS.Timeout;

  start(
    getPositions: () => Position[],
    getTrades: () => Trade[],
    getRiskStatus: () => any,
    getScannerStatus: () => any,
    getPortfolioSummary: () => string
  ): void {
    this.refreshInterval = setInterval(async () => {
      await this.render(getPositions, getTrades, getRiskStatus, getScannerStatus, getPortfolioSummary);
    }, 10000);

    // Initial render
    this.render(getPositions, getTrades, getRiskStatus, getScannerStatus, getPortfolioSummary);
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private async render(
    getPositions: () => Position[],
    getTrades: () => Trade[],
    getRiskStatus: () => any,
    getScannerStatus: () => any,
    getPortfolioSummary: () => string
  ): Promise<void> {
    try {
      const balance = await solanaUtils.getWalletBalance();
      const positions = getPositions();
      const trades = getTrades();
      const riskStatus = getRiskStatus();
      const scannerStatus = getScannerStatus();

      // Clear screen
      process.stdout.write('\x1B[2J\x1B[0f');

      const lines: string[] = [];

      // Header
      lines.push(chalk.cyan.bold('╔══════════════════════════════════════════════════════════════╗'));
      lines.push(chalk.cyan.bold('║          🤖 SOLANA MEMECOIN TRADING BOT                     ║'));
      lines.push(chalk.cyan.bold('╠══════════════════════════════════════════════════════════════╣'));

      // Wallet info
      const modeColor = process.env.MODE === 'live' ? chalk.red.bold : chalk.green.bold;
      lines.push(chalk.white(`  Mode: ${modeColor(process.env.MODE?.toUpperCase() || 'PAPER')}  |  Wallet: ${chalk.yellow(balance.toFixed(4))} SOL  |  Address: ${chalk.gray(solanaUtils.getWalletAddress().toString().slice(0, 8))}...`));
      lines.push('');

      // Scanner status
      lines.push(chalk.magenta.bold('  📡 Scanner'));
      lines.push(chalk.white(`     Status: ${scannerStatus.isRunning ? chalk.green('RUNNING') : chalk.red('STOPPED')}  |  Tokens Seen: ${scannerStatus.seenTokensCount}`));
      lines.push('');

      // Risk status
      lines.push(chalk.red.bold('  🛡️ Risk Manager'));
      const riskColor = riskStatus.cooldownActive ? chalk.red : chalk.green;
      lines.push(chalk.white(`     Daily Loss: ${chalk.yellow(riskStatus.dailyLossPct.toFixed(1))}%  |  Consecutive Losses: ${riskStatus.consecutiveLosses}  |  Cooldown: ${riskColor(riskStatus.cooldownActive ? `${riskStatus.cooldownRemaining}m` : 'OFF')}`));
      lines.push('');

      // Active positions
      const openPositions = positions.filter(p => p.status === 'OPEN');
      lines.push(chalk.yellow.bold(`  📊 Active Positions (${openPositions.length}/${process.env.MAX_POSITIONS || 3})`));
      
      if (openPositions.length === 0) {
        lines.push(chalk.gray('     No open positions'));
      } else {
        lines.push(chalk.gray('     Symbol        Entry         Current       PnL          Age'));
        lines.push(chalk.gray('     ────────────  ──────────    ──────────    ─────────    ──────'));
        
        for (const pos of openPositions) {
          const pnlColor = pos.pnlPercent >= 0 ? chalk.green : chalk.red;
          const pnlStr = `${pos.pnlPercent >= 0 ? '+' : ''}${pos.pnlPercent.toFixed(1)}%`;
          const ageMin = Math.floor((Date.now() - pos.timestamp) / 60000);
          const ageStr = ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h${ageMin % 60}m`;

          lines.push(
            `     ${chalk.white(pos.tokenSymbol.padEnd(12))}  $${pos.entryPrice.toFixed(8).padEnd(12)}  $${pos.currentPrice.toFixed(8).padEnd(12)}  ${pnlColor(pnlStr.padEnd(12))}  ${ageStr}`
          );
        }
      }
      lines.push('');

      // Recent trades
      const recentTrades = trades.slice(-5);
      lines.push(chalk.cyan.bold(`  📜 Recent Trades (last ${recentTrades.length})`));
      
      if (recentTrades.length === 0) {
        lines.push(chalk.gray('     No trades yet'));
      } else {
        lines.push(chalk.gray('     Type    Symbol        SOL           Tx              Time'));
        lines.push(chalk.gray('     ────    ──────────    ──────────    ──────────      ──────'));
        
        for (const trade of recentTrades.reverse()) {
          const typeColor = trade.type === 'BUY' ? chalk.green : chalk.red;
          const timeStr = new Date(trade.timestamp).toLocaleTimeString();
          const txShort = trade.txHash ? trade.txHash.slice(0, 10) + '...' : 'N/A';

          lines.push(
            `     ${typeColor(trade.type.padEnd(6))}  ${chalk.white(trade.tokenSymbol.padEnd(12))}  ${trade.solAmount.toFixed(4).padEnd(12)}  ${chalk.gray(txShort.padEnd(14))}  ${timeStr}`
          );
        }
      }

      lines.push('');
      lines.push(chalk.cyan.bold('╚══════════════════════════════════════════════════════════════╝'));
      lines.push(chalk.gray(`  Last updated: ${new Date().toLocaleTimeString()}  |  Press Ctrl+C to stop`));

      console.log(lines.join('\n'));
    } catch (error) {
      // Silent fail on render errors
    }
  }
}

import { config } from './config';
import { TokenScanner } from './scanner';
import { TokenChecker } from './checker';
import { ScoringEngine } from './scoring';
import { TradeExecutor } from './trader/executor';
import { PortfolioTracker } from './portfolio';
import { Dashboard } from './dashboard';
import { logger } from './utils/logger';
import { TokenPair } from './types';

class MemeBot {
  private scanner: TokenScanner;
  private checker: TokenChecker;
  private scorer: ScoringEngine;
  private executor: TradeExecutor;
  private portfolio: PortfolioTracker;
  private dashboard: Dashboard;
  private isRunning = false;

  constructor() {
    this.scanner = new TokenScanner();
    this.checker = new TokenChecker();
    this.scorer = new ScoringEngine();
    this.executor = new TradeExecutor();
    this.portfolio = new PortfolioTracker();
    this.dashboard = new Dashboard();
  }

  async start(): Promise<void> {
    logger.info('🚀 Starting Solana Memecoin Trading Bot...');
    logger.info(`Mode: ${config.mode.toUpperCase()}`);
    logger.info(`Buy amount: ${config.buyAmountSol} SOL`);
    logger.info(`Min score: ${config.minScore}`);
    logger.info(`Max positions: ${config.maxPositions}`);

    // Initialize trade executor (sets up risk manager)
    await this.executor.initialize();

    // Set up scanner callback
    this.scanner.onNewToken(async (pair: TokenPair) => {
      await this.processNewToken(pair);
    });

    // Start scanner
    await this.scanner.start();

    // Start dashboard
    this.dashboard.start(
      () => this.executor.getPositions(),
      () => this.executor.getTradeHistory(),
      () => this.executor.getRiskStatus(),
      () => this.scanner.getStatus(),
      () => this.portfolio.formatSummary()
    );

    this.isRunning = true;

    // Periodic portfolio sync
    setInterval(() => {
      this.portfolio.syncFromExecutor(
        this.executor.getPositions(),
        this.executor.getTradeHistory()
      );
    }, 30000);

    logger.success('Bot is running! Scanning for opportunities...');
  }

  private async processNewToken(pair: TokenPair): Promise<void> {
    const tokenAddress = pair.baseToken.address;
    const tokenSymbol = pair.baseToken.symbol;

    try {
      logger.scanner(`🔬 Analyzing ${tokenSymbol} (${tokenAddress.slice(0, 8)}...)`);

      // Step 1: Quick check (fast filter)
      const quickResult = await this.checker.quickCheck(tokenAddress);
      if (!quickResult.tradeable) {
        logger.info(`❌ ${tokenSymbol} failed quick check (score: ${quickResult.score}). Flags: ${quickResult.flags.join(', ')}`);
        return;
      }

      // Step 2: Full analysis
      const safetyScore = await this.checker.analyzeToken(tokenAddress, pair);

      // Step 3: Scoring decision
      const decision = this.scorer.shouldTrade(safetyScore, pair);

      // Log the score report
      const report = this.scorer.formatScoreReport(safetyScore, decision.opportunity, tokenSymbol);
      console.log(report);

      if (!decision.decision) {
        logger.info(`❌ ${tokenSymbol} skipped: ${decision.reason}`);
        return;
      }

      // Step 4: Execute trade
      logger.trade(`🎯 ${tokenSymbol} passed all checks! Confidence: ${decision.confidence}%`);
      const position = await this.executor.executeBuy(tokenAddress, tokenSymbol, pair);

      if (position) {
        this.portfolio.updatePosition(position);
        logger.success(`✅ Position opened for ${tokenSymbol}`);
      }
    } catch (error) {
      logger.error(`Failed to process token ${tokenSymbol}`, error);
    }
  }

  async stop(): Promise<void> {
    logger.info('Shutting down bot...');
    this.isRunning = false;
    this.scanner.stop();
    this.executor.stop();
    this.dashboard.stop();
    this.portfolio.saveToDisk();
    logger.info('Bot stopped. Portfolio saved.');
  }
}

// Main entry point
async function main(): Promise<void> {
  const bot = new MemeBot();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await bot.stop();
    process.exit(0);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', reason);
  });

  try {
    await bot.start();
  } catch (error) {
    logger.error('Failed to start bot', error);
    process.exit(1);
  }
}

main();

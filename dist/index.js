"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const scanner_1 = require("./scanner");
const checker_1 = require("./checker");
const scoring_1 = require("./scoring");
const executor_1 = require("./trader/executor");
const portfolio_1 = require("./portfolio");
const dashboard_1 = require("./dashboard");
const logger_1 = require("./utils/logger");
class MemeBot {
    constructor() {
        this.isRunning = false;
        this.scanner = new scanner_1.TokenScanner();
        this.checker = new checker_1.TokenChecker();
        this.scorer = new scoring_1.ScoringEngine();
        this.executor = new executor_1.TradeExecutor();
        this.portfolio = new portfolio_1.PortfolioTracker();
        this.dashboard = new dashboard_1.Dashboard();
    }
    async start() {
        logger_1.logger.info('🚀 Starting Solana Memecoin Trading Bot...');
        logger_1.logger.info(`Mode: ${config_1.config.mode.toUpperCase()}`);
        logger_1.logger.info(`Buy amount: ${config_1.config.buyAmountSol} SOL`);
        logger_1.logger.info(`Min score: ${config_1.config.minScore}`);
        logger_1.logger.info(`Max positions: ${config_1.config.maxPositions}`);
        await this.executor.initialize();
        this.scanner.onNewToken(async (pair) => {
            await this.processNewToken(pair);
        });
        await this.scanner.start();
        this.dashboard.start(() => this.executor.getPositions(), () => this.executor.getTradeHistory(), () => this.executor.getRiskStatus(), () => this.scanner.getStatus(), () => this.portfolio.formatSummary());
        this.isRunning = true;
        setInterval(() => {
            this.portfolio.syncFromExecutor(this.executor.getPositions(), this.executor.getTradeHistory());
        }, 30000);
        logger_1.logger.success('Bot is running! Scanning for opportunities...');
    }
    async processNewToken(pair) {
        const tokenAddress = pair.baseToken.address;
        const tokenSymbol = pair.baseToken.symbol;
        try {
            logger_1.logger.scanner(`🔬 Analyzing ${tokenSymbol} (${tokenAddress.slice(0, 8)}...)`);
            const quickResult = await this.checker.quickCheck(tokenAddress);
            if (!quickResult.tradeable) {
                logger_1.logger.info(`❌ ${tokenSymbol} failed quick check (score: ${quickResult.score}). Flags: ${quickResult.flags.join(', ')}`);
                return;
            }
            const safetyScore = await this.checker.analyzeToken(tokenAddress, pair);
            const decision = this.scorer.shouldTrade(safetyScore, pair);
            const report = this.scorer.formatScoreReport(safetyScore, decision.opportunity, tokenSymbol);
            console.log(report);
            if (!decision.decision) {
                logger_1.logger.info(`❌ ${tokenSymbol} skipped: ${decision.reason}`);
                return;
            }
            logger_1.logger.trade(`🎯 ${tokenSymbol} passed all checks! Confidence: ${decision.confidence}%`);
            const position = await this.executor.executeBuy(tokenAddress, tokenSymbol, pair);
            if (position) {
                this.portfolio.updatePosition(position);
                logger_1.logger.success(`✅ Position opened for ${tokenSymbol}`);
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to process token ${tokenSymbol}`, error);
        }
    }
    async stop() {
        logger_1.logger.info('Shutting down bot...');
        this.isRunning = false;
        this.scanner.stop();
        this.executor.stop();
        this.dashboard.stop();
        this.portfolio.saveToDisk();
        logger_1.logger.info('Bot stopped. Portfolio saved.');
    }
}
async function main() {
    const bot = new MemeBot();
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
        logger_1.logger.error('Unhandled rejection', reason);
    });
    try {
        await bot.start();
    }
    catch (error) {
        logger_1.logger.error('Failed to start bot', error);
        process.exit(1);
    }
}
main();

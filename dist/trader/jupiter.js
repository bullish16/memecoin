"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JupiterClient = void 0;
const web3_js_1 = require("@solana/web3.js");
const node_fetch_1 = __importDefault(require("node-fetch"));
const logger_1 = require("../utils/logger");
const solana_1 = require("../utils/solana");
const config_1 = require("../config");
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_URL = 'https://quote-api.jup.ag/v6/swap';
class JupiterClient {
    constructor() {
        this.connection = solana_1.solanaUtils.getConnection();
        this.wallet = solana_1.solanaUtils.getWallet();
    }
    async getQuote(inputMint, outputMint, amount, slippageBps) {
        try {
            const params = new URLSearchParams({
                inputMint,
                outputMint,
                amount: amount.toString(),
                slippageBps: (slippageBps || config_1.config.slippageBps).toString(),
                onlyDirectRoutes: 'false',
                asLegacyTransaction: 'false',
            });
            const response = await (0, node_fetch_1.default)(`${JUPITER_QUOTE_URL}?${params}`);
            if (!response.ok) {
                const errorText = await response.text();
                logger_1.logger.error(`Jupiter quote failed: ${response.status} - ${errorText}`);
                return null;
            }
            const quote = (await response.json());
            logger_1.logger.debug(`Jupiter quote: ${inputMint} → ${outputMint}, in=${amount}, out=${quote.outAmount}, impact=${quote.priceImpactPct}%`);
            return quote;
        }
        catch (error) {
            logger_1.logger.error('Failed to get Jupiter quote', error);
            return null;
        }
    }
    async executeSwap(quote) {
        try {
            const swapBody = {
                quoteResponse: quote,
                userPublicKey: this.wallet.publicKey.toString(),
                wrapAndUnwrapSol: true,
                dynamicComputeUnitLimit: true,
                prioritizationFeeLamports: 'auto',
            };
            const swapResponse = await (0, node_fetch_1.default)(JUPITER_SWAP_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(swapBody),
            });
            if (!swapResponse.ok) {
                const errorText = await swapResponse.text();
                logger_1.logger.error(`Jupiter swap API failed: ${swapResponse.status} - ${errorText}`);
                return null;
            }
            const swapData = (await swapResponse.json());
            const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
            const transaction = web3_js_1.VersionedTransaction.deserialize(swapTransactionBuf);
            transaction.sign([this.wallet]);
            const rawTransaction = transaction.serialize();
            const txId = await this.connection.sendRawTransaction(rawTransaction, {
                skipPreflight: true,
                maxRetries: 3,
            });
            logger_1.logger.trade(`Transaction sent: ${txId}`);
            const confirmation = await this.connection.confirmTransaction({
                signature: txId,
                blockhash: transaction.message.recentBlockhash,
                lastValidBlockHeight: swapData.lastValidBlockHeight,
            }, 'confirmed');
            if (confirmation.value.err) {
                logger_1.logger.error(`Transaction failed: ${txId}`, confirmation.value.err);
                return null;
            }
            logger_1.logger.success(`Transaction confirmed: ${txId}`);
            return txId;
        }
        catch (error) {
            logger_1.logger.error('Failed to execute Jupiter swap', error);
            return null;
        }
    }
    async buyToken(tokenMint, solAmount) {
        try {
            const amountLamports = solana_1.solanaUtils.solToLamports(solAmount);
            const quote = await this.getQuote(SOL_MINT, tokenMint, amountLamports);
            if (!quote) {
                logger_1.logger.error(`No quote available for buying ${tokenMint}`);
                return null;
            }
            const priceImpact = parseFloat(quote.priceImpactPct);
            if (priceImpact > 10) {
                logger_1.logger.warning(`High price impact: ${priceImpact}% — aborting buy`);
                return null;
            }
            if (config_1.config.mode === 'paper') {
                logger_1.logger.trade(`[PAPER] BUY ${solAmount} SOL → ${tokenMint} | Out: ${quote.outAmount} | Impact: ${priceImpact}%`);
                return { txHash: `paper_${Date.now()}`, amountOut: quote.outAmount };
            }
            const txHash = await this.executeSwap(quote);
            if (!txHash)
                return null;
            return { txHash, amountOut: quote.outAmount };
        }
        catch (error) {
            logger_1.logger.error(`Failed to buy token ${tokenMint}`, error);
            return null;
        }
    }
    async sellToken(tokenMint, tokenAmount, decimals = 9) {
        try {
            const rawAmount = Math.floor(tokenAmount * Math.pow(10, decimals));
            const quote = await this.getQuote(tokenMint, SOL_MINT, rawAmount);
            if (!quote) {
                logger_1.logger.error(`No quote available for selling ${tokenMint}`);
                return null;
            }
            const priceImpact = parseFloat(quote.priceImpactPct);
            if (priceImpact > 15) {
                logger_1.logger.warning(`High sell price impact: ${priceImpact}% — proceeding with caution`);
            }
            if (config_1.config.mode === 'paper') {
                logger_1.logger.trade(`[PAPER] SELL ${tokenAmount} of ${tokenMint} → ${quote.outAmount} lamports | Impact: ${priceImpact}%`);
                return { txHash: `paper_${Date.now()}`, solOut: quote.outAmount };
            }
            const txHash = await this.executeSwap(quote);
            if (!txHash)
                return null;
            return { txHash, solOut: quote.outAmount };
        }
        catch (error) {
            logger_1.logger.error(`Failed to sell token ${tokenMint}`, error);
            return null;
        }
    }
    async sellPercentage(tokenMint, percentage) {
        try {
            const balance = await solana_1.solanaUtils.getTokenBalance(tokenMint);
            if (balance <= 0) {
                logger_1.logger.warning(`No balance of ${tokenMint} to sell`);
                return null;
            }
            const sellAmount = balance * (percentage / 100);
            return this.sellToken(tokenMint, sellAmount);
        }
        catch (error) {
            logger_1.logger.error(`Failed to sell percentage of ${tokenMint}`, error);
            return null;
        }
    }
}
exports.JupiterClient = JupiterClient;

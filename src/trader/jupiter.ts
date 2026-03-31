import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import fetch from 'node-fetch';
import { JupiterQuoteResponse, JupiterSwapResponse } from '../types';
import { logger } from '../utils/logger';
import { solanaUtils } from '../utils/solana';
import { config } from '../config';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_URL = 'https://quote-api.jup.ag/v6/swap';

export class JupiterClient {
  private connection: Connection;
  private wallet: Keypair;

  constructor() {
    this.connection = solanaUtils.getConnection();
    this.wallet = solanaUtils.getWallet();
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps?: number
  ): Promise<JupiterQuoteResponse | null> {
    try {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: (slippageBps || config.slippageBps).toString(),
        onlyDirectRoutes: 'false',
        asLegacyTransaction: 'false',
      });

      const response = await fetch(`${JUPITER_QUOTE_URL}?${params}`);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Jupiter quote failed: ${response.status} - ${errorText}`);
        return null;
      }

      const quote = (await response.json()) as JupiterQuoteResponse;
      logger.debug(`Jupiter quote: ${inputMint} → ${outputMint}, in=${amount}, out=${quote.outAmount}, impact=${quote.priceImpactPct}%`);
      return quote;
    } catch (error) {
      logger.error('Failed to get Jupiter quote', error);
      return null;
    }
  }

  async executeSwap(quote: JupiterQuoteResponse): Promise<string | null> {
    try {
      const swapBody = {
        quoteResponse: quote,
        userPublicKey: this.wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      };

      const swapResponse = await fetch(JUPITER_SWAP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(swapBody),
      });

      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        logger.error(`Jupiter swap API failed: ${swapResponse.status} - ${errorText}`);
        return null;
      }

      const swapData = (await swapResponse.json()) as JupiterSwapResponse;

      // Deserialize and sign the transaction
      const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([this.wallet]);

      // Send the transaction
      const rawTransaction = transaction.serialize();
      const txId = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 3,
      });

      logger.trade(`Transaction sent: ${txId}`);

      // Confirm the transaction
      const confirmation = await this.connection.confirmTransaction(
        {
          signature: txId,
          blockhash: transaction.message.recentBlockhash,
          lastValidBlockHeight: swapData.lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        logger.error(`Transaction failed: ${txId}`, confirmation.value.err);
        return null;
      }

      logger.success(`Transaction confirmed: ${txId}`);
      return txId;
    } catch (error) {
      logger.error('Failed to execute Jupiter swap', error);
      return null;
    }
  }

  async buyToken(tokenMint: string, solAmount: number): Promise<{ txHash: string; amountOut: string } | null> {
    try {
      const amountLamports = solanaUtils.solToLamports(solAmount);

      // Get quote
      const quote = await this.getQuote(SOL_MINT, tokenMint, amountLamports);
      if (!quote) {
        logger.error(`No quote available for buying ${tokenMint}`);
        return null;
      }

      // Check price impact
      const priceImpact = parseFloat(quote.priceImpactPct);
      if (priceImpact > 10) {
        logger.warning(`High price impact: ${priceImpact}% — aborting buy`);
        return null;
      }

      if (config.mode === 'paper') {
        logger.trade(`[PAPER] BUY ${solAmount} SOL → ${tokenMint} | Out: ${quote.outAmount} | Impact: ${priceImpact}%`);
        return { txHash: `paper_${Date.now()}`, amountOut: quote.outAmount };
      }

      // Execute swap
      const txHash = await this.executeSwap(quote);
      if (!txHash) return null;

      return { txHash, amountOut: quote.outAmount };
    } catch (error) {
      logger.error(`Failed to buy token ${tokenMint}`, error);
      return null;
    }
  }

  async sellToken(tokenMint: string, tokenAmount: number, decimals: number = 9): Promise<{ txHash: string; solOut: string } | null> {
    try {
      const rawAmount = Math.floor(tokenAmount * Math.pow(10, decimals));

      // Get quote
      const quote = await this.getQuote(tokenMint, SOL_MINT, rawAmount);
      if (!quote) {
        logger.error(`No quote available for selling ${tokenMint}`);
        return null;
      }

      const priceImpact = parseFloat(quote.priceImpactPct);
      if (priceImpact > 15) {
        logger.warning(`High sell price impact: ${priceImpact}% — proceeding with caution`);
      }

      if (config.mode === 'paper') {
        logger.trade(`[PAPER] SELL ${tokenAmount} of ${tokenMint} → ${quote.outAmount} lamports | Impact: ${priceImpact}%`);
        return { txHash: `paper_${Date.now()}`, solOut: quote.outAmount };
      }

      const txHash = await this.executeSwap(quote);
      if (!txHash) return null;

      return { txHash, solOut: quote.outAmount };
    } catch (error) {
      logger.error(`Failed to sell token ${tokenMint}`, error);
      return null;
    }
  }

  async sellPercentage(tokenMint: string, percentage: number): Promise<{ txHash: string; solOut: string } | null> {
    try {
      const balance = await solanaUtils.getTokenBalance(tokenMint);
      if (balance <= 0) {
        logger.warning(`No balance of ${tokenMint} to sell`);
        return null;
      }

      const sellAmount = balance * (percentage / 100);
      return this.sellToken(tokenMint, sellAmount);
    } catch (error) {
      logger.error(`Failed to sell percentage of ${tokenMint}`, error);
      return null;
    }
  }
}

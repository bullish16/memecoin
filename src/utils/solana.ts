import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getMint, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { config } from '../config';
import { logger } from './logger';

export class SolanaUtils {
  private connection: Connection;
  private wallet: Keypair;

  constructor() {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    try {
      const secretKey = bs58.decode(config.privateKey);
      this.wallet = Keypair.fromSecretKey(secretKey);
      logger.success(`Wallet loaded: ${this.wallet.publicKey.toString()}`);
    } catch (error) {
      logger.error('Failed to load wallet from private key', error);
      throw error;
    }
  }

  getConnection(): Connection {
    return this.connection;
  }

  getWallet(): Keypair {
    return this.wallet;
  }

  getWalletAddress(): PublicKey {
    return this.wallet.publicKey;
  }

  async getWalletBalance(): Promise<number> {
    try {
      const balance = await this.connection.getBalance(this.wallet.publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      logger.error('Failed to get wallet balance', error);
      return 0;
    }
  }

  async getTokenBalance(tokenAddress: string): Promise<number> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.wallet.publicKey,
        { mint: mintPubkey }
      );

      if (tokenAccounts.value.length === 0) {
        return 0;
      }

      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      return balance || 0;
    } catch (error) {
      logger.error(`Failed to get token balance for ${tokenAddress}`, error);
      return 0;
    }
  }

  async getMintInfo(tokenAddress: string) {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const mintInfo = await getMint(this.connection, mintPubkey);
      return {
        decimals: mintInfo.decimals,
        supply: mintInfo.supply.toString(),
        hasMintAuthority: mintInfo.mintAuthority !== null,
        hasFreezeAuthority: mintInfo.freezeAuthority !== null,
        isInitialized: mintInfo.isInitialized
      };
    } catch (error) {
      logger.error(`Failed to get mint info for ${tokenAddress}`, error);
      return null;
    }
  }

  async getTokenHolders(tokenAddress: string): Promise<any[]> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const accounts = await this.connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
        filters: [
          {
            dataSize: 165, // Token account size
          },
          {
            memcmp: {
              offset: 0,
              bytes: mintPubkey.toBase58(),
            },
          },
        ],
      });

      const holders = [];
      for (const account of accounts) {
        try {
          const tokenAccount = await getAccount(this.connection, account.pubkey);
          if (tokenAccount.amount > 0) {
            holders.push({
              owner: tokenAccount.owner.toString(),
              amount: tokenAccount.amount.toString(),
            });
          }
        } catch (error) {
          // Skip invalid accounts
          continue;
        }
      }

      // Sort by amount descending
      holders.sort((a, b) => Number(b.amount) - Number(a.amount));
      return holders;
    } catch (error) {
      logger.error(`Failed to get token holders for ${tokenAddress}`, error);
      return [];
    }
  }

  async simulateTransaction(transaction: any): Promise<boolean> {
    try {
      const result = await this.connection.simulateTransaction(transaction);
      return result.value.err === null;
    } catch (error) {
      logger.error('Failed to simulate transaction', error);
      return false;
    }
  }

  lamportsToSol(lamports: number): number {
    return lamports / LAMPORTS_PER_SOL;
  }

  solToLamports(sol: number): number {
    return Math.floor(sol * LAMPORTS_PER_SOL);
  }

  async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async retryAsync<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T | null> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        logger.warning(`Retry ${i + 1}/${maxRetries} failed`, error);
        if (i === maxRetries - 1) {
          logger.error('All retries exhausted');
          return null;
        }
        await this.sleep(delay * (i + 1));
      }
    }
    return null;
  }
}

export const solanaUtils = new SolanaUtils();
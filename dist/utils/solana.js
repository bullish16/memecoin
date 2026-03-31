"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.solanaUtils = exports.SolanaUtils = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const bs58_1 = __importDefault(require("bs58"));
const config_1 = require("../config");
const logger_1 = require("./logger");
class SolanaUtils {
    constructor() {
        this.connection = new web3_js_1.Connection(config_1.config.solanaRpcUrl, 'confirmed');
        try {
            const secretKey = bs58_1.default.decode(config_1.config.privateKey);
            this.wallet = web3_js_1.Keypair.fromSecretKey(secretKey);
            logger_1.logger.success(`Wallet loaded: ${this.wallet.publicKey.toString()}`);
        }
        catch (error) {
            logger_1.logger.error('Failed to load wallet from private key', error);
            throw error;
        }
    }
    getConnection() {
        return this.connection;
    }
    getWallet() {
        return this.wallet;
    }
    getWalletAddress() {
        return this.wallet.publicKey;
    }
    async getWalletBalance() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            return balance / web3_js_1.LAMPORTS_PER_SOL;
        }
        catch (error) {
            logger_1.logger.error('Failed to get wallet balance', error);
            return 0;
        }
    }
    async getTokenBalance(tokenAddress) {
        try {
            const mintPubkey = new web3_js_1.PublicKey(tokenAddress);
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(this.wallet.publicKey, { mint: mintPubkey });
            if (tokenAccounts.value.length === 0) {
                return 0;
            }
            const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
            return balance || 0;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get token balance for ${tokenAddress}`, error);
            return 0;
        }
    }
    async getMintInfo(tokenAddress) {
        try {
            const mintPubkey = new web3_js_1.PublicKey(tokenAddress);
            const mintInfo = await (0, spl_token_1.getMint)(this.connection, mintPubkey);
            return {
                decimals: mintInfo.decimals,
                supply: mintInfo.supply.toString(),
                hasMintAuthority: mintInfo.mintAuthority !== null,
                hasFreezeAuthority: mintInfo.freezeAuthority !== null,
                isInitialized: mintInfo.isInitialized
            };
        }
        catch (error) {
            logger_1.logger.error(`Failed to get mint info for ${tokenAddress}`, error);
            return null;
        }
    }
    async getTokenHolders(tokenAddress) {
        try {
            const mintPubkey = new web3_js_1.PublicKey(tokenAddress);
            const accounts = await this.connection.getProgramAccounts(spl_token_1.TOKEN_PROGRAM_ID, {
                filters: [
                    {
                        dataSize: 165,
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
                    const tokenAccount = await (0, spl_token_1.getAccount)(this.connection, account.pubkey);
                    if (tokenAccount.amount > 0) {
                        holders.push({
                            owner: tokenAccount.owner.toString(),
                            amount: tokenAccount.amount.toString(),
                        });
                    }
                }
                catch (error) {
                    continue;
                }
            }
            holders.sort((a, b) => Number(b.amount) - Number(a.amount));
            return holders;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get token holders for ${tokenAddress}`, error);
            return [];
        }
    }
    async simulateTransaction(transaction) {
        try {
            const result = await this.connection.simulateTransaction(transaction);
            return result.value.err === null;
        }
        catch (error) {
            logger_1.logger.error('Failed to simulate transaction', error);
            return false;
        }
    }
    lamportsToSol(lamports) {
        return lamports / web3_js_1.LAMPORTS_PER_SOL;
    }
    solToLamports(sol) {
        return Math.floor(sol * web3_js_1.LAMPORTS_PER_SOL);
    }
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async retryAsync(fn, maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            }
            catch (error) {
                logger_1.logger.warning(`Retry ${i + 1}/${maxRetries} failed`, error);
                if (i === maxRetries - 1) {
                    logger_1.logger.error('All retries exhausted');
                    return null;
                }
                await this.sleep(delay * (i + 1));
            }
        }
        return null;
    }
}
exports.SolanaUtils = SolanaUtils;
exports.solanaUtils = new SolanaUtils();

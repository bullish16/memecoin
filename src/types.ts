import { PublicKey } from '@solana/web3.js';

export interface TokenPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd?: string;
  txns: {
    m5: {
      buys: number;
      sells: number;
    };
    h1: {
      buys: number;
      sells: number;
    };
    h6: {
      buys: number;
      sells: number;
    };
    h24: {
      buys: number;
      sells: number;
    };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  pairs: TokenPair[];
}

export interface ContractCheck {
  score: number;
  flags: string[];
  hasMintAuthority: boolean;
  hasFreezeAuthority: boolean;
  isRevoked: boolean;
}

export interface LiquidityCheck {
  score: number;
  flags: string[];
  liquidityUsd: number;
  isLpBurned: boolean;
  isLpLocked: boolean;
  lpRatioToMcap: number;
}

export interface HolderCheck {
  score: number;
  flags: string[];
  totalHolders: number;
  top10Concentration: number;
  devWalletPct: number;
  bundledWallets: number;
}

export interface RugCheckResult {
  score: number;
  flags: string[];
  risks: string[];
  warnings: string[];
}

export interface HoneypotCheck {
  score: number;
  flags: string[];
  canSell: boolean;
  sellTax: number;
  buyTax: number;
}

export interface TokenScore {
  overall: number;
  contract: ContractCheck;
  liquidity: LiquidityCheck;
  holders: HolderCheck;
  rugcheck: RugCheckResult;
  honeypot: HoneypotCheck;
  category: 'SAFE' | 'MODERATE' | 'RISKY' | 'DANGEROUS';
  tradeable: boolean;
}

export interface Position {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  entryPrice: number;
  currentPrice: number;
  amount: number;
  solInvested: number;
  pnl: number;
  pnlPercent: number;
  timestamp: number;
  status: 'OPEN' | 'CLOSED';
}

export interface Trade {
  id: string;
  type: 'BUY' | 'SELL';
  tokenAddress: string;
  tokenSymbol: string;
  price: number;
  amount: number;
  solAmount: number;
  timestamp: number;
  txHash?: string;
  reason?: string;
}

export interface DashboardData {
  walletBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  activePositions: Position[];
  recentTrades: Trade[];
  scannerActivity: string;
  riskMetrics: {
    dailyLoss: number;
    dailyLossPercent: number;
    positionCount: number;
    maxPositions: number;
  };
}

export interface Config {
  solanaRpcUrl: string;
  privateKey: string;
  mode: 'paper' | 'live';
  buyAmountSol: number;
  slippageBps: number;
  takeProfitLevels: {
    '2x': number;
    '5x': number;
    '10x': number;
  };
  stopLossPct: number;
  maxPositions: number;
  maxDailyLossPct: number;
  minScore: number;
  scanIntervalMs: number;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: any;
  priceImpactPct: string;
  routePlan: any[];
}

export interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
}
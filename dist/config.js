"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function getEnvVar(name, defaultValue) {
    const value = process.env[name];
    if (!value && !defaultValue) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return value || defaultValue;
}
function getEnvNumber(name, defaultValue) {
    const value = process.env[name];
    if (!value)
        return defaultValue;
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
        throw new Error(`Environment variable ${name} must be a valid number`);
    }
    return parsed;
}
exports.config = {
    solanaRpcUrl: getEnvVar('SOLANA_RPC_URL'),
    privateKey: getEnvVar('PRIVATE_KEY'),
    mode: getEnvVar('MODE', 'paper'),
    buyAmountSol: getEnvNumber('BUY_AMOUNT_SOL', 0.02),
    slippageBps: getEnvNumber('SLIPPAGE_BPS', 1500),
    takeProfitLevels: {
        '2x': getEnvNumber('TAKE_PROFIT_2X', 0.5),
        '5x': getEnvNumber('TAKE_PROFIT_5X', 0.3),
        '10x': getEnvNumber('TAKE_PROFIT_10X', 0.2)
    },
    stopLossPct: getEnvNumber('STOP_LOSS_PCT', 30),
    maxPositions: getEnvNumber('MAX_POSITIONS', 3),
    maxDailyLossPct: getEnvNumber('MAX_DAILY_LOSS_PCT', 50),
    minScore: getEnvNumber('MIN_SCORE', 60),
    scanIntervalMs: getEnvNumber('SCAN_INTERVAL_MS', 10000)
};
if (!['paper', 'live'].includes(exports.config.mode)) {
    throw new Error('MODE must be either "paper" or "live"');
}
if (exports.config.buyAmountSol <= 0) {
    throw new Error('BUY_AMOUNT_SOL must be greater than 0');
}
if (exports.config.slippageBps < 0 || exports.config.slippageBps > 10000) {
    throw new Error('SLIPPAGE_BPS must be between 0 and 10000');
}
if (exports.config.minScore < 0 || exports.config.minScore > 100) {
    throw new Error('MIN_SCORE must be between 0 and 100');
}
console.log(`✅ Configuration loaded - Mode: ${exports.config.mode.toUpperCase()}`);

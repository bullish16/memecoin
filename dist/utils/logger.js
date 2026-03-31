"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = void 0;
const chalk_1 = __importDefault(require("chalk"));
class Logger {
    constructor() { }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    formatTimestamp() {
        return new Date().toISOString().replace('T', ' ').slice(0, -5);
    }
    info(message, data) {
        console.log(chalk_1.default.blue(`[${this.formatTimestamp()}] ℹ️  ${message}`));
        if (data)
            console.log(chalk_1.default.gray(JSON.stringify(data, null, 2)));
    }
    success(message, data) {
        console.log(chalk_1.default.green(`[${this.formatTimestamp()}] ✅ ${message}`));
        if (data)
            console.log(chalk_1.default.gray(JSON.stringify(data, null, 2)));
    }
    warning(message, data) {
        console.log(chalk_1.default.yellow(`[${this.formatTimestamp()}] ⚠️  ${message}`));
        if (data)
            console.log(chalk_1.default.gray(JSON.stringify(data, null, 2)));
    }
    error(message, error) {
        console.log(chalk_1.default.red(`[${this.formatTimestamp()}] ❌ ${message}`));
        if (error) {
            if (error instanceof Error) {
                console.log(chalk_1.default.red(error.stack || error.message));
            }
            else {
                console.log(chalk_1.default.red(JSON.stringify(error, null, 2)));
            }
        }
    }
    debug(message, data) {
        if (process.env.NODE_ENV === 'development') {
            console.log(chalk_1.default.magenta(`[${this.formatTimestamp()}] 🐛 ${message}`));
            if (data)
                console.log(chalk_1.default.gray(JSON.stringify(data, null, 2)));
        }
    }
    trade(message, data) {
        console.log(chalk_1.default.cyan(`[${this.formatTimestamp()}] 💰 ${message}`));
        if (data)
            console.log(chalk_1.default.gray(JSON.stringify(data, null, 2)));
    }
    scanner(message, data) {
        console.log(chalk_1.default.magenta(`[${this.formatTimestamp()}] 🔍 ${message}`));
        if (data)
            console.log(chalk_1.default.gray(JSON.stringify(data, null, 2)));
    }
    risk(message, data) {
        console.log(chalk_1.default.red(`[${this.formatTimestamp()}] 🚨 ${message}`));
        if (data)
            console.log(chalk_1.default.gray(JSON.stringify(data, null, 2)));
    }
}
exports.Logger = Logger;
exports.logger = Logger.getInstance();

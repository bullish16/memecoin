import chalk from 'chalk';

export class Logger {
  private static instance: Logger;
  
  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatTimestamp(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, -5);
  }

  info(message: string, data?: any): void {
    console.log(chalk.blue(`[${this.formatTimestamp()}] ℹ️  ${message}`));
    if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));
  }

  success(message: string, data?: any): void {
    console.log(chalk.green(`[${this.formatTimestamp()}] ✅ ${message}`));
    if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));
  }

  warning(message: string, data?: any): void {
    console.log(chalk.yellow(`[${this.formatTimestamp()}] ⚠️  ${message}`));
    if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));
  }

  error(message: string, error?: any): void {
    console.log(chalk.red(`[${this.formatTimestamp()}] ❌ ${message}`));
    if (error) {
      if (error instanceof Error) {
        console.log(chalk.red(error.stack || error.message));
      } else {
        console.log(chalk.red(JSON.stringify(error, null, 2)));
      }
    }
  }

  debug(message: string, data?: any): void {
    if (process.env.NODE_ENV === 'development') {
      console.log(chalk.magenta(`[${this.formatTimestamp()}] 🐛 ${message}`));
      if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
  }

  trade(message: string, data?: any): void {
    console.log(chalk.cyan(`[${this.formatTimestamp()}] 💰 ${message}`));
    if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));
  }

  scanner(message: string, data?: any): void {
    console.log(chalk.magenta(`[${this.formatTimestamp()}] 🔍 ${message}`));
    if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));
  }

  risk(message: string, data?: any): void {
    console.log(chalk.red(`[${this.formatTimestamp()}] 🚨 ${message}`));
    if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));
  }
}

export const logger = Logger.getInstance();
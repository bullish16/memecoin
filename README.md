# 🤖 Solana Memecoin Trading Bot

Bot trading memecoin otomatis di Solana dengan scam detection, risk management, dan CLI dashboard.

## ⚠️ DISCLAIMER

**Bot ini bukan mesin cetak uang.** Trading memecoin sangat berisiko. Gunakan uang yang kamu siap kehilangan. Mulai dengan paper trading mode dulu.

## 🚀 Fitur

- **Token Scanner** — Monitor token baru di Raydium/DexScreener + Pump.fun graduates
- **Scam Checker** — Cek mint/freeze authority, liquidity lock, holder concentration, RugCheck.xyz
- **Honeypot Detection** — Simulasi sell via Jupiter untuk deteksi honeypot
- **Scoring Engine** — Safety score + Opportunity score = keputusan trade
- **Auto Trade** — Buy/sell via Jupiter Aggregator
- **Risk Management** — Stop-loss, take-profit bertingkat, max positions, daily loss limit, cooldown
- **Portfolio Tracker** — PnL tracking, trade history, statistik
- **CLI Dashboard** — Real-time monitoring dengan warna

## 📦 Instalasi

```bash
# Clone atau copy folder ini ke VPS kamu
cd solana-memecoin-bot

# Install dependencies
npm install

# Copy dan edit config
cp .env.example .env
nano .env

# Build
npm run build

# Jalankan
npm start
```

## ⚙️ Konfigurasi (.env)

```env
# Wajib
SOLANA_RPC_URL=https://your-quicknode-endpoint
PRIVATE_KEY=private_key_wallet_kamu_base58

# Mode: paper (simulasi) atau live (uang beneran)
MODE=paper

# Trading parameters
BUY_AMOUNT_SOL=0.02        # Jumlah SOL per trade
SLIPPAGE_BPS=1500           # Slippage 15%
TAKE_PROFIT_2X=0.5          # Jual 50% saat 2x
TAKE_PROFIT_5X=0.3          # Jual 30% saat 5x
TAKE_PROFIT_10X=0.2         # Jual 20% saat 10x
STOP_LOSS_PCT=30            # Stop loss -30%

# Risk management
MAX_POSITIONS=3             # Max posisi terbuka
MAX_DAILY_LOSS_PCT=50       # Max kerugian harian 50%
MIN_SCORE=60                # Min safety score untuk trade

# Scanner
SCAN_INTERVAL_MS=10000      # Scan setiap 10 detik
```

## 🔄 Cara Kerja

```
Token Scanner → Quick Check → Full Analysis → Scoring → Trade Decision
     ↓              ↓             ↓              ↓           ↓
  DexScreener    Contract     Contract       Safety +    Buy via
  Pump.fun       + Rugcheck   Liquidity      Opportunity  Jupiter
                              Holders                      ↓
                              Rugcheck              Risk Manager
                              Honeypot              Stop-Loss
                                                    Take-Profit
```

### Safety Score (0-100)
| Check | Weight | Apa yang dicek |
|-------|--------|----------------|
| Contract | 25% | Mint authority, freeze authority |
| Liquidity | 20% | LP burned/locked, amount, ratio |
| Holders | 20% | Top 10 concentration, dev wallet, bundled |
| RugCheck | 25% | RugCheck.xyz API analysis |
| Honeypot | 10% | Simulasi sell via Jupiter |

### Opportunity Score (0-100)
| Factor | Weight | Apa yang dicek |
|--------|--------|----------------|
| Momentum | 30% | Volume acceleration, price trend |
| Freshness | 20% | Umur token (sweet spot: 5-30 min) |
| Buy Pressure | 30% | Buy vs sell ratio |
| Liquidity Depth | 20% | Absolute liquidity + ratio to mcap |

### Risk Management
- **Position sizing**: Max 30% wallet per trade
- **Gas reserve**: Selalu sisakan 0.01 SOL
- **Stop-loss**: Default -30%
- **Take-profit**: Bertingkat (2x, 5x, 10x)
- **Cooldown**: 15 menit setelah 3 kerugian berturut-turut
- **Daily limit**: Stop trading setelah loss melebihi threshold

## 🧪 Tips

1. **Mulai paper mode** — Jalankan beberapa hari di paper mode, lihat hasilnya
2. **RPC penting** — Pakai QuickNode/Helius untuk kecepatan. Public RPC terlalu lambat
3. **Budget realistis** — Minimal 0.5 SOL untuk trading yang meaningful
4. **Monitor** — Cek dashboard secara berkala, jangan tinggal begitu saja
5. **Adjust parameters** — Sesuaikan MIN_SCORE, stop-loss, dll berdasarkan hasil paper trading

## 📁 Struktur

```
src/
├── index.ts          # Main entry, orchestration
├── config.ts         # Environment config
├── types.ts          # TypeScript types
├── dashboard.ts      # CLI dashboard
├── scanner/          # Token discovery
├── checker/          # Scam detection (5 modules)
├── scoring/          # Decision engine
├── trader/           # Trade execution + risk
└── portfolio/        # PnL tracking
```

## 🛑 Emergency Stop

`Ctrl+C` — Bot akan gracefully shutdown dan save portfolio ke disk.

---

Made with 🤖 by OpenClaw

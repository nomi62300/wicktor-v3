# Wicktor v3 — Multi-Timeframe Crypto Screener & Trade Engine

Wicktor v3 is an institutional-grade, multi-timeframe crypto and tokenized asset scanner with dynamic structural trade planning, real-time regime classification, and an empirical scoring engine.

Zero build steps. Plain HTML, CSS, and modern JavaScript running natively in the browser or via automated backtesting tools.

---

## What's New in v3

### 1. Dynamic Local Swing R:R Structure (Coupled 1R / 2R / 3R)
- **Local Swing Stop Loss:** Anchored directly to the confirmation timeframe (15M) local swing highs/lows + ATR buffer, avoiding the oversized drawdowns of wide 1H stops and the fee degradation of tight 5M stops.
- **Risk Bounded:** Floor at `0.8%` to prevent unwinnable fee burden; ceiling at `4.0%` to avoid holding wide, slow intraday swings.
- **Dynamic R-Multiples:** Target profit is dynamically coupled to structural risk:
  - **TP1 (1R):** 1:1 risk-to-reward ratio (scale out / de-risk)
  - **TP2 (2R):** 2:1 risk-to-reward ratio (primary take-profit)
  - **TP3 (3R):** 3:1 risk-to-reward ratio (runner)
- **Elimination of Inverted R:R:** Strict viability gate requiring `ratio >= 1.0`. Setups with poor risk-reward are automatically capped at 45 (AVOID).

### 2. Extreme Wick Rejection Trigger (`wickRejection`)
- Detects institutional absorption and pin bars where `wick >= 3.5x body` and `wick >= 0.4x ATR`.
- Backtested over **8,944 signals**: emerged as the **#1 performing scalp trigger** with **$+0.053 balanced edge** across both bull and bear market drift.

### 3. Intermediate Momentum Control Line (15M RSI 50)
- Uses the 15M RSI 50 midline to filter out low-conviction counter-trend trades.
- Longs must maintain RSI $\ge 50$ and Shorts must hold RSI $\le 50$ to receive the $+10$ momentum bonus; counter-momentum trades are penalized and demoted to AVOID.

### 4. Direct Client-Side Live Scanner
- Runs directly inside the browser using Bybit's public API klines, completely independent of the legacy v2 cloud database.
- Evaluates top liquid perpetuals live every 3 minutes, with an on-demand **Live Scan** button in the header.
- Dynamic coin search: type any asset (e.g. `FLUID`, `AVA`, `NEAR`) into the search bar to score it live on the fly.

---

## Architecture & Timeframe Hierarchy

| Timeframe | Role | Indicators & Checks |
| :--- | :--- | :--- |
| **1H (Macro Context)** | Regime & Bias | Williams Alligator Mouth (Trending, Ranging, Transition, Squeeze), ADX, Macro EMA Stack |
| **15M (Confirmation & Swing SL)** | Structure & Quality | Local Swing High/Low Structure, 15M RSI 50 Control Line, MACD Momentum |
| **5M (Execution & Trigger)** | Timing & Invalidation | `wickRejection`, `levelBreak`, `macdCross`, `stochCrossFromExtreme`, `bandBreakout` |

---

## Running the App

### Option 1: Direct in Browser
Open `index.html` directly in any modern browser (Chrome, Safari, Brave, Edge). No Node.js build process is required.

### Option 2: Local HTTP Server
If your browser restricts local filesystem script loading:
```bash
python3 -m http.server 8000
# Open http://localhost:8000 in your browser
```

> **Access Code:** The test gate code for Wicktor v3 is `wkt-v3-test`.

---

## Testing & Backtesting Suite

Wicktor includes a deterministic testing and simulation engine in `tools/` and `tests/`:

### Run Unit Tests
```bash
node --test tests/indicators.test.js
```

### Run Backtest Simulation
Walks historical fixtures bar-by-bar using strict point-in-time timestamp alignment (no future lookahead) and simulates forward execution:
```bash
# Scalp mode (5M entry, 24-bar hold, minScore 50)
node tools/backtest-v2.js 50 24 scalp

# Swing mode (15M entry, 24-bar hold, minScore 50)
node tools/backtest-v2.js 50 24 swing
```

### Score Market Fixtures & Diff
```bash
node tools/score-fixtures.js v3 tools/fixtures/market-sample.json tools/snapshots
node tools/diff-scores.js tools/snapshots/baseline.json tools/snapshots/v3.json
```

---

## Data Sources (Free Tiers)
- **Bybit v5 API:** Real-time spot and perpetual contract tickers and klines.
- **CoinGecko:** Global market capitalization, dominance, and sector categorization.
- **alternative.me:** Crypto Fear & Greed Index.
- **FMP (Financial Modeling Prep):** Per-coin news stream (optional free API key in Settings).

---

## Project Structure

```
├── index.html               # Main application shell & terminal layout
├── css/
│   └── style.css            # Responsive dark/light terminal styling
├── js/
│   ├── indicators.js        # Mathematical indicators, triggers & swing SL geometry
│   ├── scoring.js           # Trade quality scoring & regime alignment engine
│   ├── api.js               # Resilient external exchange & market API client
│   ├── render.js            # High-performance DOM cards & trade plan renderer
│   └── app.js               # App orchestration, scan cycles & state management
├── tests/
│   └── indicators.test.js   # Comprehensive Node.js unit test suite
├── tools/
│   ├── backtest-v2.js       # Empirical walk-forward backtest simulator
│   ├── score-fixtures.js    # Deterministic snapshot generator
│   ├── diff-scores.js       # Snapshot comparison utility
│   └── fixtures/            # Frozen market klines for regression testing
├── CHANGELOG.md             # Detailed release history & versioning
└── README.md                # Project documentation & guide
```

#!/usr/bin/env node
/* ==========================================================================
   Wicktor — Standalone Pure WM Filter Backtest (NO Wicktor Baseline Core)
   Evaluates RAW Orion Momentum Filters directly on market candles:
   - NO Wicktor Scoring (no score >= 80/85 filter)
   - NO Alligator alignment or squeeze / divergence requirements
   - PURE breakout entries directly on momentum condition firing:
     1. WM Standard: 1h>0, 4h>0, 1h rsi>=60 (Short: 1h<0, 4h<0, rsi<=40)
     2. +Ve & Vol (All-TF): 15m>0.25%, 1h>0, 4h>0, 1d>0
     3. 15M Impulse: 15m > 2% (Short: 15m < -2%)
     4. Small-Cap Pump: Mcap < $500M & 15m > 1.5%
     5. Large-Cap Trend: Mcap >= $500M & 1h > 0.5%
     6. 5M Scalp Spike: 5m > 1.5%
     7. Combined WM: Any of the 6 above
   Stop loss set at standard momentum failure level (1.5x ATR / 3-bar swing low).
   Simulated across $10,000 USDT prop firm rules (Plan A, B, C).
   ========================================================================== */

const fs = require('fs');
const path = require('path');
global.Indicators = require('../js/indicators.js');
const PortfolioSimulator = require('../js/portfolio.js');
const I = global.Indicators;
const { closedIndexAt, TF_MS } = require('./lib/align.js');

const WIN = 200;
const WARMUP = 90;
const HOLD_BARS = 48; // 4 hours max hold

const hydrate = t => t ? t.map(([a, o, h, l, c, v]) => ({ t: a, o, h, l, c, v })) : null;
const windowed = (arr, end) => arr.slice(Math.max(0, end - WIN + 1), end + 1);

const LARGE_CAPS = new Set([
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 
  'LINKUSDT', 'SUIUSDT', 'NEARUSDT', 'APTUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT'
]);

function simulateTradeOutcomes(candles, from, dir, entry, stop, target, maxBars = 48) {
  const end = Math.min(from + maxBars, candles.length - 1);
  const risk = Math.abs(entry - stop);
  if (!risk) return null;

  const tp1 = entry + dir * 1.0 * risk;
  const tp2 = entry + dir * 2.0 * risk;
  const tp3 = target; // 3R

  let tp1Hit = false;
  let tp2Hit = false;
  let tp3Hit = false;

  let outcomeA = null;
  let outcomeB = null;
  let outcomeC = null;
  let exitReason = 'timeout';
  let resolvedBar = end;

  let currentTrailStop = stop;
  let highestFavorableR = 0;

  for (let k = from + 1; k <= end; k++) {
    const bar = candles[k];
    const hitSL = dir === 1 ? bar.l <= stop : bar.h >= stop;
    const hitTP1 = dir === 1 ? bar.h >= tp1 : bar.l <= tp1;
    const hitTP2 = dir === 1 ? bar.h >= tp2 : bar.l <= tp2;
    const hitTP3 = dir === 1 ? bar.h >= tp3 : bar.l <= tp3;

    if (hitTP1 && !tp1Hit) tp1Hit = true;
    if (hitTP2 && !tp2Hit) tp2Hit = true;
    if (hitTP3 && !tp3Hit) tp3Hit = true;

    const currentFavR = dir === 1 ? (bar.h - entry) / risk : (entry - bar.l) / risk;
    if (currentFavR > highestFavorableR) highestFavorableR = currentFavR;

    // Plan A
    if (outcomeA == null) {
      if (hitTP2) {
        outcomeA = 2.0;
      } else if (tp1Hit && (dir === 1 ? bar.l <= entry : bar.h >= entry)) {
        outcomeA = 0.0;
      } else if (hitSL) {
        outcomeA = -1.0;
      }
    }

    // Plan B
    if (outcomeB == null) {
      if (hitTP3) {
        outcomeB = 3.0;
      } else if (hitSL) {
        outcomeB = -1.0;
      }
    }

    // Plan C
    if (outcomeC == null) {
      if (hitTP3) {
        outcomeC = 3.0;
        exitReason = 'TP3 Full Winner';
        resolvedBar = k;
      } else if (tp2Hit) {
        currentTrailStop = tp1;
        const hitRatchet = dir === 1 ? bar.l <= currentTrailStop : bar.h >= currentTrailStop;
        if (hitRatchet) {
          outcomeC = 1.33;
          exitReason = 'TP2 Ratchet Exit';
          resolvedBar = k;
        }
      } else if (tp1Hit) {
        const trailingR = Math.max(0, highestFavorableR - 0.5);
        const trailPrice = entry + dir * trailingR * risk;
        if (dir === 1 ? bar.l <= trailPrice : bar.h >= trailPrice) {
          outcomeC = Math.max(0.33, (1 / 3) * 1.0 + (2 / 3) * trailingR);
          exitReason = 'Dynamic Trail Hit';
          resolvedBar = k;
        }
      } else if (hitSL) {
        outcomeC = -1.0;
        exitReason = 'Initial SL Hit';
        resolvedBar = k;
      }
    }

    if (outcomeA != null && outcomeB != null && outcomeC != null) break;
  }

  const finalClose = candles[end].c;
  const finalR = (dir * (finalClose - entry)) / risk;

  if (outcomeA == null) outcomeA = tp1Hit ? Math.max(0, (1 / 3) * 1.0 + (2 / 3) * finalR) : Math.max(-1, finalR);
  if (outcomeB == null) outcomeB = Math.max(-1, finalR);
  if (outcomeC == null) outcomeC = tp1Hit ? Math.max(0.33, (1 / 3) * 1.0 + (2 / 3) * Math.max(0, finalR)) : Math.max(-1, finalR);

  return {
    outcomeA,
    outcomeB,
    outcomeC,
    tp1Hit,
    tp2Hit,
    tp3Hit,
    exitReason,
    durationMin: (resolvedBar - from) * 5,
    resolvedBarTime: candles[resolvedBar].t
  };
}

async function run() {
  const deepFile = path.join(__dirname, 'fixtures', 'market-deep.json');
  console.log('Loading market-deep.json fixtures (60 coins across 3 market cycles)...');
  const fx = JSON.parse(fs.readFileSync(deepFile, 'utf8'));

  const variants = [
    { id: 'standard', name: 'Raw WM Standard (1H+4H Velocity + RSI)' },
    { id: 'allTf', name: 'Raw Sub-Filter 1 (+Ve & Vol: All-TF Green)' },
    { id: 'impulse15m', name: 'Raw Sub-Filter 2 (15M Impulse >2%)' },
    { id: 'smallCap', name: 'Raw Sub-Filter 3 (Small-Cap Pump)' },
    { id: 'largeCap', name: 'Raw Sub-Filter 4 (Large-Cap Trend Expansion)' },
    { id: 'spike5m', name: 'Raw Sub-Filter 5 (5M Scalp Spike >1.5%)' },
    { id: 'combined', name: 'Raw Combined WM (Any of the 6 Raw Filters)' }
  ];

  const resultsByVariant = {
    standard: [],
    allTf: [],
    impulse15m: [],
    smallCap: [],
    largeCap: [],
    spike5m: [],
    combined: []
  };

  for (let wIdx = 0; wIdx < fx.windows.length; wIdx++) {
    const win = fx.windows[wIdx];
    console.log(`Testing market window ${wIdx + 1}/${fx.windows.length} (${win.coins.length} coins)...`);

    for (const coin of win.coins) {
      const m5 = hydrate(coin.candles.m5);
      const m15 = hydrate(coin.candles.m15);
      const h1 = hydrate(coin.candles.h1);

      if (!m5 || !m15 || !h1 || m5.length < WARMUP + HOLD_BARS + 5) continue;

      const isLargeCap = LARGE_CAPS.has(coin.symbol);

      // Track active trade cooldown per variant so we simulate realistic entries
      const openUntil = {
        standard: { 1: -1, '-1': -1 },
        allTf: { 1: -1, '-1': -1 },
        impulse15m: { 1: -1, '-1': -1 },
        smallCap: { 1: -1, '-1': -1 },
        largeCap: { 1: -1, '-1': -1 },
        spike5m: { 1: -1, '-1': -1 },
        combined: { 1: -1, '-1': -1 }
      };

      for (let i = WARMUP; i < m5.length - HOLD_BARS; i += 3) {
        const ts = m5[i].t;
        const ci15 = closedIndexAt(m15, ts, TF_MS.m15);
        const ci1h = closedIndexAt(h1, ts, TF_MS.h1);

        if (ci15 < WARMUP || ci1h < 60) continue;

        const currentClose = m5[i].c;
        const prev5m = m5[i - 1] ? m5[i - 1].c : currentClose;
        const prev15m = m15[ci15 - 1] ? m15[ci15 - 1].c : currentClose;
        const prev1h = h1[ci1h - 1] ? h1[ci1h - 1].c : currentClose;
        const prev4h = h1[ci1h - 4] ? h1[ci1h - 4].c : prev1h;
        const prev1d = h1[ci1h - 24] ? h1[ci1h - 24].c : (h1[ci1h - 4] ? h1[ci1h - 4].c : prev1h);

        const chg5mPct = prev5m ? ((currentClose - prev5m) / prev5m) * 100 : 0;
        const chg15mPct = prev15m ? ((currentClose - prev15m) / prev15m) * 100 : 0;
        const chg1hPct = prev1h ? ((currentClose - prev1h) / prev1h) * 100 : 0;
        const chg4hPct = prev4h ? ((currentClose - prev4h) / prev4h) * 100 : 0;
        const chg1dPct = prev1d ? ((currentClose - prev1d) / prev1d) * 100 : 0;

        // Calculate 1h RSI directly
        const rsiSeries = I.rsi(h1.slice(Math.max(0, ci1h - 50), ci1h + 1), 14);
        const rsi1h = rsiSeries && rsiSeries.length ? (rsiSeries[rsiSeries.length - 1] || 50) : 50;

        // Calculate ATR for standardized volatility-based stop loss (1.5x ATR)
        const trSeries = [];
        for (let j = Math.max(1, i - 14); j <= i; j++) {
          const high = m5[j].h;
          const low = m5[j].l;
          const prevC = m5[j-1].c;
          trSeries.push(Math.max(high - low, Math.abs(high - prevC), Math.abs(low - prevC)));
        }
        const atr = trSeries.reduce((s, v) => s + v, 0) / (trSeries.length || 1);
        const riskDistance = Math.max(currentClose * 0.006, 1.5 * atr);

        // Test both Long and Short directions
        for (const dir of [1, -1]) {
          const isLong = dir === 1;

          // 1. Raw WM Standard: 1h + 4h velocity + 1h RSI
          const pass_standard = isLong
            ? (chg1hPct > 0 && chg4hPct > 0 && rsi1h >= 60)
            : (chg1hPct < 0 && chg4hPct < 0 && rsi1h <= 40);

          // 2. Raw +Ve & Vol: All-TF Alignment
          const pass_allTf = isLong
            ? (chg15mPct > 0.25 && chg1hPct > 0 && chg4hPct > 0 && chg1dPct > 0)
            : (chg15mPct < -0.25 && chg1hPct < 0 && chg4hPct < 0 && chg1dPct < 0);

          // 3. Raw 15M Impulse: >= 2% Expansion
          const pass_impulse15m = isLong ? (chg15mPct >= 2.0) : (chg15mPct <= -2.0);

          // 4. Raw Small-Cap Pump: Mcap < $500M & 15M >= 1.5%
          const pass_smallCap = !isLargeCap && (isLong ? chg15mPct >= 1.5 : chg15mPct <= -1.5);

          // 5. Raw Large-Cap Trend Expansion: Mcap >= $500M & 1H >= 0.5%
          const pass_largeCap = isLargeCap && (isLong ? chg1hPct >= 0.5 : chg1hPct <= -0.5);

          // 6. Raw 5M Scalp Spike: 5M >= 1.5%
          const pass_spike5m = isLong ? (chg5mPct >= 1.5) : (chg5mPct <= -1.5);

          // 7. Raw Combined WM
          const pass_combined = pass_standard || pass_allTf || pass_impulse15m || pass_smallCap || pass_largeCap || pass_spike5m;

          const flags = {
            standard: pass_standard,
            allTf: pass_allTf,
            impulse15m: pass_impulse15m,
            smallCap: pass_smallCap,
            largeCap: pass_largeCap,
            spike5m: pass_spike5m,
            combined: pass_combined
          };

          const stop = isLong ? currentClose - riskDistance : currentClose + riskDistance;
          const target = isLong ? currentClose + 3 * riskDistance : currentClose - 3 * riskDistance;

          let cachedSim = null;

          for (const v of variants) {
            if (flags[v.id]) {
              if (i >= openUntil[v.id][dir]) {
                if (!cachedSim) {
                  cachedSim = simulateTradeOutcomes(m5, i, dir, currentClose, stop, target, HOLD_BARS);
                }
                if (cachedSim) {
                  openUntil[v.id][dir] = i + Math.round(cachedSim.durationMin / 5);
                  resultsByVariant[v.id].push({
                    symbol: coin.symbol,
                    market: 'PERP',
                    direction: dir,
                    score: 85, // Set to 85 for portfolio simulator compatibility
                    entry: currentClose,
                    stop,
                    target,
                    risk_pct: (riskDistance / currentClose) * 100,
                    bar_time: ts,
                    resolved_bar_time: cachedSim.resolvedBarTime,
                    status: 'resolved',
                    duration_min: cachedSim.durationMin,
                    exit_reason: cachedSim.exitReason,
                    outcome_a: cachedSim.outcomeA,
                    outcome_b: cachedSim.outcomeB,
                    outcome_c: cachedSim.outcomeC
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  console.log('\n' + '='.repeat(105));
  console.log('STANDALONE BACKTEST: PURE MOMENTUM FILTERS WITHOUT WICKTOR BASELINE SCANNER');
  console.log('='.repeat(105));

  for (const v of variants) {
    const sigs = resultsByVariant[v.id];
    console.log(`\n⚡ [ ${v.name} ]`);
    console.log(`   Total Qualifying Triggers: ${sigs.length}`);
    if (!sigs.length) {
      console.log('   No triggers fired.');
      continue;
    }

    const meanA = sigs.reduce((s, r) => s + r.outcome_a, 0) / sigs.length;
    const meanB = sigs.reduce((s, r) => s + r.outcome_b, 0) / sigs.length;
    const meanC = sigs.reduce((s, r) => s + r.outcome_c, 0) / sigs.length;

    const winCountA = sigs.filter(r => r.outcome_a > 0).length;
    const winCountB = sigs.filter(r => r.outcome_b > 0).length;
    const winCountC = sigs.filter(r => r.outcome_c > 0).length;

    console.log(`   Expectancy (Mean R): Plan A: ${meanA >= 0 ? '+' : ''}${meanA.toFixed(3)}R | Plan B: ${meanB >= 0 ? '+' : ''}${meanB.toFixed(3)}R | Plan C: ${meanC >= 0 ? '+' : ''}${meanC.toFixed(3)}R`);
    console.log(`   Raw Win Rates:      Plan A: ${((winCountA / sigs.length) * 100).toFixed(1)}% | Plan B: ${((winCountB / sigs.length) * 100).toFixed(1)}% | Plan C: ${((winCountC / sigs.length) * 100).toFixed(1)}%`);

    const simA = PortfolioSimulator.simulate(sigs, { startingCapital: 10000, plan: 'A', minScore: 80 });
    const simB = PortfolioSimulator.simulate(sigs, { startingCapital: 10000, plan: 'B', minScore: 80 });
    const simC = PortfolioSimulator.simulate(sigs, { startingCapital: 10000, plan: 'C', minScore: 80 });

    console.log(`   $10k Prop Portfolio Performance:`);
    console.log(`   • Plan A (2R BE):     ${simA.summary.totalTrades} Trades | WR: ${simA.summary.winRatePct.toFixed(1)}% | Net: ${simA.summary.netProfit >= 0 ? '+$' : '-$'}${Math.abs(simA.summary.netProfit).toFixed(2)} (${simA.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simA.summary.profitFactor.toFixed(2)} | Max DD: ${simA.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
    console.log(`   • Plan B (3R Runner): ${simB.summary.totalTrades} Trades | WR: ${simB.summary.winRatePct.toFixed(1)}% | Net: ${simB.summary.netProfit >= 0 ? '+$' : '-$'}${Math.abs(simB.summary.netProfit).toFixed(2)} (${simB.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simB.summary.profitFactor.toFixed(2)} | Max DD: ${simB.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
    console.log(`   • Plan C (Dyn Trail): ${simC.summary.totalTrades} Trades | WR: ${simC.summary.winRatePct.toFixed(1)}% | Net: ${simC.summary.netProfit >= 0 ? '+$' : '-$'}${Math.abs(simC.summary.netProfit).toFixed(2)} (${simC.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simC.summary.profitFactor.toFixed(2)} | Max DD: ${simC.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
  }
}

run().catch(console.error);

#!/usr/bin/env node
/* ==========================================================================
   Wicktor — Empirical Backtest of OREO Momentum Filter (Orion + RSI Heatmap)

   Tests your mentor's exact setup against our deep market fixtures (60 coins,
   24 distinct market windows across bullish, bearish, and ranging regimes):

   Mentor's OREO Rules:
   - Longs (Bull Setup):
     * 1H Price Change > 0%
     * 4H Price Change > 0%
     * 1H RSI >= 60 (CMC RSI Heatmap momentum confirmation)
   - Shorts (Bear Setup):
     * 1H Price Change < 0%
     * 4H Price Change < 0%
     * 1H RSI <= 40 (CMC RSI Heatmap bearish expansion)

   Evaluates:
   - Win Rate (Long vs Short)
   - Mean R (Long vs Short, and Balanced R)
   - Plan A, Plan B, and Plan C Realized P&L
   - Simulated $10,000 Portfolio performance (ROI, Win Rate, Profit Factor, DD)
   ========================================================================== */

const fs = require('fs');
const path = require('path');
global.Indicators = require('../js/indicators.js');
const Scoring = require('../js/scoring.js');
const PortfolioSimulator = require('../js/portfolio.js');
const I = global.Indicators;
const { closedIndexAt, TF_MS } = require('./lib/align.js');

const WIN = 200;
const WARMUP = 90;
const HOLD_BARS = 48; // 48 x 5m = 4h (matches Plan C)

const hydrate = t => t ? t.map(([a, o, h, l, c, v]) => ({ t: a, o, h, l, c, v })) : null;
const windowed = (arr, end) => arr.slice(Math.max(0, end - WIN + 1), end + 1);

function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

function fmtR(v) {
  if (v == null || isNaN(v)) return '--';
  return (v >= 0 ? '+' : '') + v.toFixed(3) + 'R';
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return '--';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function fmtDollar(v) {
  if (v == null || isNaN(v)) return '--';
  return (v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function simulateTradeOutcomes(candles, from, dir, entry, stop, target, maxBars = 48) {
  const end = Math.min(from + maxBars, candles.length - 1);
  const risk = Math.abs(entry - stop);
  if (!risk) return null;

  const tp1 = entry + dir * 1.0 * risk;
  const tp2 = entry + dir * 2.0 * risk;
  const tp3 = target; // ~3R

  let tp1Hit = false;
  let tp2Hit = false;
  let tp3Hit = false;

  let outcomeA = null;
  let outcomeB = null;
  let outcomeC = null;
  let exitReason = 'timeout';
  let resolvedBar = end;

  // Plan C dynamic trailing state
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

    // Track excursion in R
    const currentFavR = dir === 1 ? (bar.h - entry) / risk : (entry - bar.l) / risk;
    if (currentFavR > highestFavorableR) highestFavorableR = currentFavR;

    // Plan A calculation
    if (outcomeA == null) {
      if (hitTP2) {
        outcomeA = 2.0;
      } else if (tp1Hit && (dir === 1 ? bar.l <= entry : bar.h >= entry)) {
        outcomeA = 0.0; // stopped out at breakeven after TP1
      } else if (hitSL) {
        outcomeA = -1.0;
      }
    }

    // Plan B calculation
    if (outcomeB == null) {
      if (hitTP3) {
        outcomeB = 3.0;
      } else if (hitSL) {
        outcomeB = -1.0;
      }
    }

    // Plan C calculation (Dynamic 0.5R trail behind peak closed candle)
    if (outcomeC == null) {
      if (hitTP3) {
        outcomeC = 3.0;
        exitReason = 'TP3 Full Winner';
        resolvedBar = k;
      } else if (tp2Hit) {
        currentTrailStop = tp1; // Floor ratcheted to at least TP1 (+1R)
        const hitRatchet = dir === 1 ? bar.l <= currentTrailStop : bar.h >= currentTrailStop;
        if (hitRatchet) {
          outcomeC = 1.33; // 1/3 at 1R, 1/3 at 2R, 1/3 stopped at 1R = 1.33R
          exitReason = 'TP2 Ratchet Exit';
          resolvedBar = k;
        }
      } else if (tp1Hit) {
        // Trailing stop moves at 0.5R behind highest excursion
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

  // Mark-to-market at window close if not resolved
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

function runBacktest() {
  const deepFile = path.join(__dirname, 'fixtures', 'market-deep.json');
  if (!fs.existsSync(deepFile)) {
    console.error('Fixture file not found: tools/fixtures/market-deep.json');
    process.exit(1);
  }

  console.log('Loading market-deep.json (60 coins across 24 market windows)...');
  const fx = JSON.parse(fs.readFileSync(deepFile, 'utf8'));

  const minScore = 80; // EXCELLENT band

  // Collect candidate setups
  const allBaselineSignals = [];
  const oreoSignals = [];
  const oreoVelocityOnlySignals = [];
  const oreoRsiOnlySignals = [];

  let totalCandlesEvaluated = 0;

  for (const win of fx.windows) {
    for (const coin of win.coins) {
      const m5 = hydrate(coin.candles.m5);
      const m15 = hydrate(coin.candles.m15);
      const h1 = hydrate(coin.candles.h1);

      if (!m5 || !m15 || !h1 || m5.length < WARMUP + HOLD_BARS + 5) continue;

      let openUntil = { 1: -1, '-1': -1 };

      for (let i = WARMUP; i < m5.length - HOLD_BARS; i++) {
        totalCandlesEvaluated++;
        const ts = m5[i].t;
        const ci15 = closedIndexAt(m15, ts, TF_MS.m15);
        const ci1h = closedIndexAt(h1, ts, TF_MS.h1);

        if (ci15 < WARMUP || ci1h < 60) continue;

        const snapH1 = I.analyzeTimeframe(windowed(h1, ci1h));
        const snapM15 = I.analyzeTimeframe(windowed(m15, ci15));
        const snapM5 = I.analyzeTimeframe(windowed(m5, i));

        if (!snapH1 || !snapM15 || !snapM5) continue;

        const evalRes = Scoring.evaluateSnapshots([snapH1, snapM15, snapM5], { mode: 'scalp' });
        if (!evalRes || !evalRes.setupDirection || evalRes.score < minScore) continue;

        const dir = evalRes.setupDirection;
        if (i < openUntil[dir]) continue;

        const entry = m5[i].c;
        const rr = evalRes.riskReward;
        if (!rr || !rr.viable || !rr.stop || !rr.target) continue;

        // Calculate 1h and 4h price change
        const currentClose = m5[i].c;
        const close1hAgo = h1[ci1h - 1] ? h1[ci1h - 1].c : currentClose;
        const close4hAgo = h1[ci1h - 4] ? h1[ci1h - 4].c : (h1[ci1h - 1] ? h1[ci1h - 1].c : currentClose);

        const chg1hPct = close1hAgo ? ((currentClose - close1hAgo) / close1hAgo) * 100 : 0;
        const chg4hPct = close4hAgo ? ((currentClose - close4hAgo) / close4hAgo) * 100 : 0;
        const rsi1h = snapH1.rsi || 50;

        // Simulate trade
        const sim = simulateTradeOutcomes(m5, i, dir, entry, rr.stop, rr.target, HOLD_BARS);
        if (!sim) continue;

        openUntil[dir] = i + Math.round(sim.durationMin / 5);

        const signalObj = {
          symbol: coin.symbol,
          market: 'PERP',
          direction: dir,
          score: evalRes.score,
          entry,
          stop: rr.stop,
          target: rr.target,
          risk_pct: evalRes.riskReward.riskPct || 2.0,
          bar_time: ts,
          resolved_bar_time: sim.resolvedBarTime,
          status: 'resolved',
          duration_min: sim.durationMin,
          exit_reason: sim.exitReason,
          outcome_a: sim.outcomeA,
          outcome_b: sim.outcomeB,
          outcome_c: sim.outcomeC,
          chg1hPct,
          chg4hPct,
          rsi1h
        };

        allBaselineSignals.push(signalObj);

        // OREO Filter Evaluation
        const isLong = dir === 1;
        const isShort = dir === -1;

        // Velocity Filter
        const passesVelocity = isLong
          ? (chg1hPct > 0 && chg4hPct > 0)
          : (chg1hPct < 0 && chg4hPct < 0);

        // CMC RSI Heatmap Filter
        const passesRsi = isLong
          ? (rsi1h >= 60)
          : (rsi1h <= 40);

        // Combined OREO Momentum Filter
        if (passesVelocity && passesRsi) {
          oreoSignals.push(signalObj);
        }

        if (passesVelocity) {
          oreoVelocityOnlySignals.push(signalObj);
        }

        if (passesRsi) {
          oreoRsiOnlySignals.push(signalObj);
        }
      }
    }
  }

  console.log(`\n================================================================`);
  console.log(`  OREO MOMENTUM FILTER EMPIRICAL BACKTEST REPORT`);
  console.log(`================================================================`);
  console.log(`Total market candles scanned: ${totalCandlesEvaluated.toLocaleString()}`);
  console.log(`Total Baseline EXCELLENT Signals (Score >= 80): ${allBaselineSignals.length}`);
  console.log(`Signals Passing OREO Momentum Filter: ${oreoSignals.length} (${((oreoSignals.length / allBaselineSignals.length) * 100).toFixed(1)}% selected)`);

  function printGroupMetrics(name, signals) {
    const longs = signals.filter(s => s.direction === 1);
    const shorts = signals.filter(s => s.direction === -1);

    const winA = signals.filter(s => s.outcome_a > 0).length / (signals.length || 1) * 100;
    const winB = signals.filter(s => s.outcome_b > 0).length / (signals.length || 1) * 100;
    const winC = signals.filter(s => s.outcome_c > 0).length / (signals.length || 1) * 100;

    const meanA = mean(signals.map(s => s.outcome_a));
    const meanB = mean(signals.map(s => s.outcome_b));
    const meanC = mean(signals.map(s => s.outcome_c));

    const longWinC = longs.length ? longs.filter(s => s.outcome_c > 0).length / longs.length * 100 : 0;
    const shortWinC = shorts.length ? shorts.filter(s => s.outcome_c > 0).length / shorts.length * 100 : 0;
    const longMeanC = mean(longs.map(s => s.outcome_c));
    const shortMeanC = mean(shorts.map(s => s.outcome_c));
    const balancedC = (longs.length && shorts.length) ? (longMeanC + shortMeanC) / 2 : (longMeanC || shortMeanC);

    // Simulate $10,000 portfolio on Plan C (realistic slots = 5, risk = 1%)
    const simC = PortfolioSimulator.simulate(signals, { plan: 'C', minScore: 80, maxConcurrentSlots: 5 });
    const sC = simC.summary;

    console.log(`\n----------------------------------------------------------------`);
    console.log(`▶ ${name.toUpperCase()} (Total Signals: ${signals.length} | Longs: ${longs.length}, Shorts: ${shorts.length})`);
    console.log(`----------------------------------------------------------------`);
    console.log(`Plan C Win Rate:        ${winC.toFixed(1)}% (Longs: ${longWinC.toFixed(1)}% | Shorts: ${shortWinC.toFixed(1)}%)`);
    console.log(`Plan C Mean R:          ${fmtR(meanC)} (Long: ${fmtR(longMeanC)} | Short: ${fmtR(shortMeanC)} | Balanced: ${fmtR(balancedC)})`);
    console.log(`Plan A Win Rate:        ${winA.toFixed(1)}% | Mean R: ${fmtR(meanA)}`);
    console.log(`Plan B Win Rate:        ${winB.toFixed(1)}% | Mean R: ${fmtR(meanB)}`);
    console.log(`\n  $10,000 Portfolio Simulation (Plan C, 5 Slots, 1% Risk, 0.11% Taker Fees):`);
    console.log(`  * Trades Executed:    ${sC.totalTrades} (${sC.wins}W / ${sC.losses}L)`);
    console.log(`  * Net Profit ($):      ${fmtDollar(sC.netProfit)} (${fmtPct(sC.netRoiPct)} ROI)`);
    console.log(`  * Profit Factor:      ${sC.profitFactor.toFixed(2)}`);
    console.log(`  * Max Daily DD:       ${sC.maxDailyDdEncounteredPct.toFixed(2)}% (Max 4% closed limit)`);
    console.log(`  * Midnight Max DD:    ${sC.maxOverallDdEncounteredPct.toFixed(2)}% (Max 8% floor limit)`);
    console.log(`  * Account Status:     ${sC.statusText}`);

    return { winC, meanC, balancedC, netProfit: sC.netProfit, pf: sC.profitFactor };
  }

  const mBaseline = printGroupMetrics('1. Baseline (All EXCELLENT Setups - No OREO Filter)', allBaselineSignals);
  const mVelocity = printGroupMetrics('2. Orion Velocity Only (1H & 4H Change Alignment)', oreoVelocityOnlySignals);
  const mRsi = printGroupMetrics('3. CMC RSI Heatmap Only (1H RSI >=60 Long / <=40 Short)', oreoRsiOnlySignals);
  const mOreo = printGroupMetrics('4. FULL OREO MOMENTUM FILTER (Orion Velocity + CMC RSI Heatmap)', oreoSignals);

  console.log(`\n================================================================`);
  console.log(`  SUMMARY COMPARISON: BASELINE vs OREO MOMENTUM FILTER`);
  console.log(`================================================================`);
  console.log(`Metric               Baseline         OREO Momentum Filter   Improvement`);
  console.log(`----------------------------------------------------------------`);
  console.log(`Plan C Win Rate:     ${mBaseline.winC.toFixed(1)}%            ${mOreo.winC.toFixed(1)}%                 +${(mOreo.winC - mBaseline.winC).toFixed(1)}%`);
  console.log(`Plan C Balanced R:   ${fmtR(mBaseline.balancedC)}         ${fmtR(mOreo.balancedC)}              ${fmtR(mOreo.balancedC - mBaseline.balancedC)}`);
  console.log(`Profit Factor:       ${mBaseline.pf.toFixed(2)}             ${mOreo.pf.toFixed(2)}                  +${(mOreo.pf - mBaseline.pf).toFixed(2)}`);
  console.log(`$10k Net ROI:        ${fmtDollar(mBaseline.netProfit)}       ${fmtDollar(mOreo.netProfit)}          +${fmtDollar(mOreo.netProfit - mBaseline.netProfit)}`);
  console.log(`================================================================\n`);
}

runBacktest();

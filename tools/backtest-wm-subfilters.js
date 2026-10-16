#!/usr/bin/env node
/* ==========================================================================
   Wicktor — Empirical Backtest of WM Filter & 6 Orion Sub-Filter Variants
   Tests across:
   1. Baseline Wicktor (Score >= 80)
   2. WM Standard: 1H+4H Velocity + 1H RSI Momentum (Long: 1h>0, 4h>0, rsi>=60 | Short: 1h<0, 4h<0, rsi<=40)
   3. WM Sub-Filter 1 (+Ve & Vol): All-TF Positive Momentum (15m>0.25%, 1h>0, 4h>0, 1d>0)
   4. WM Sub-Filter 2 (15M Impulse >2%): 15m candle expansion (>2% long, <-2% short)
   5. WM Sub-Filter 3 (Small-Cap Pump): Mcap < $500M + 15m > 1.5% surge
   6. WM Sub-Filter 4 (Large-Cap Expansion): Mcap >= $500M + 1h > 0.5% trend
   7. WM Sub-Filter 5 (5M Scalp Spike): 5m immediate spike (>1.5% long, <-1.5% short)
   8. WM Master Combined: Qualifies under WM Standard OR any validated sub-filter
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
const HOLD_BARS = 48; // 48 x 5m = 4 hours

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
  const tp3 = target; // ~3R

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
  console.log('Loading market-deep.json fixtures...');
  const fx = JSON.parse(fs.readFileSync(deepFile, 'utf8'));

  const minScore = 80;

  const allSignals = [];

  for (let wIdx = 0; wIdx < fx.windows.length; wIdx++) {
    const win = fx.windows[wIdx];
    console.log(`Analyzing window ${wIdx + 1}/${fx.windows.length} (${win.coins.length} coins)...`);
    for (const coin of win.coins) {
      const m5 = hydrate(coin.candles.m5);
      const m15 = hydrate(coin.candles.m15);
      const h1 = hydrate(coin.candles.h1);

      if (!m5 || !m15 || !h1 || m5.length < WARMUP + HOLD_BARS + 5) continue;

      let openUntil = { 1: -1, '-1': -1 };

      // Step every 3 bars (15 minutes) for high-performance scanning
      for (let i = WARMUP; i < m5.length - HOLD_BARS; i += 3) {
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
        const rsi1h = snapH1.rsi || 50;

        const isLargeCap = LARGE_CAPS.has(coin.symbol);

        const sim = simulateTradeOutcomes(m5, i, dir, entry, rr.stop, rr.target, HOLD_BARS);
        if (!sim) continue;

        openUntil[dir] = i + Math.round(sim.durationMin / 5);

        const isLong = dir === 1;

        // 1. WM Standard: 1h + 4h velocity + 1h RSI
        const f_standard = isLong
          ? (chg1hPct > 0 && chg4hPct > 0 && rsi1h >= 60)
          : (chg1hPct < 0 && chg4hPct < 0 && rsi1h <= 40);

        // 2. +Ve & Vol: 15m > 0.25%, 1h > 0, 4h > 0, 1d > 0
        const f_ve_vol = isLong
          ? (chg15mPct > 0.25 && chg1hPct > 0 && chg4hPct > 0 && chg1dPct > 0)
          : (chg15mPct < -0.25 && chg1hPct < 0 && chg4hPct < 0 && chg1dPct < 0);

        // 3. 15M Impulse (>2%): 15m change > 2%
        const f_15m_impulse = isLong ? (chg15mPct > 2.0) : (chg15mPct < -2.0);

        // 4. Small-Cap Pump: not large cap + 15m > 1.5%
        const f_small_pump = !isLargeCap && (isLong ? chg15mPct > 1.5 : chg15mPct < -1.5);

        // 5. Large-Cap Expansion: large cap + 1h > 0.5%
        const f_large_expansion = isLargeCap && (isLong ? chg1hPct > 0.5 : chg1hPct < -0.5);

        // 6. 5M Scalp Spike: 5m change > 1.5%
        const f_5m_spike = isLong ? (chg5mPct > 1.5) : (chg5mPct < -1.5);

        // 7. WM Master Combined
        const f_wm_master = f_standard || f_ve_vol || f_15m_impulse || f_small_pump || f_large_expansion;

        allSignals.push({
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
          f_standard,
          f_ve_vol,
          f_15m_impulse,
          f_small_pump,
          f_large_expansion,
          f_5m_spike,
          f_wm_master
        });
      }
    }
  }

  console.log(`\nSuccessfully evaluated ${allSignals.length} baseline qualified signals.`);

  const groups = [
    { name: 'Baseline Wicktor (Score >= 80, No Filter)', filter: s => true },
    { name: 'WM Standard (1h+4h Velocity + RSI)', filter: s => s.f_standard },
    { name: 'WM Sub-Filter 1 (+Ve & Vol: All-TF Green)', filter: s => s.f_ve_vol },
    { name: 'WM Sub-Filter 2 (15M Impulse >2%)', filter: s => s.f_15m_impulse },
    { name: 'WM Sub-Filter 3 (Small-Cap Pump)', filter: s => s.f_small_pump },
    { name: 'WM Sub-Filter 4 (Large-Cap Expansion)', filter: s => s.f_large_expansion },
    { name: 'WM Sub-Filter 5 (5M Scalp Spike)', filter: s => s.f_5m_spike },
    { name: 'WM Master Ensemble (Any Validated WM Setup)', filter: s => s.f_wm_master }
  ];

  console.log('\n' + '='.repeat(100));
  console.log('EMPIRICAL PERFORMANCE MATRIX: BASELINE VS. ALL WM SUB-FILTER VARIANTS');
  console.log('='.repeat(100));

  for (const g of groups) {
    const sigs = allSignals.filter(g.filter);
    if (!sigs.length) {
      console.log(`\n[ ${g.name} ]: 0 qualifying signals`);
      continue;
    }

    const simA = PortfolioSimulator.simulate(sigs, { startingCapital: 10000, plan: 'A', minScore: 80 });
    const simB = PortfolioSimulator.simulate(sigs, { startingCapital: 10000, plan: 'B', minScore: 80 });
    const simC = PortfolioSimulator.simulate(sigs, { startingCapital: 10000, plan: 'C', minScore: 80 });

    const meanRA = sigs.reduce((a, b) => a + b.outcome_a, 0) / sigs.length;
    const meanRB = sigs.reduce((a, b) => a + b.outcome_b, 0) / sigs.length;
    const meanRC = sigs.reduce((a, b) => a + b.outcome_c, 0) / sigs.length;

    console.log(`\n📌 ${g.name}`);
    console.log(`   Signals: ${sigs.length} | Plan A Mean R: ${meanRA > 0 ? '+' : ''}${meanRA.toFixed(3)}R | Plan B: ${meanRB > 0 ? '+' : ''}${meanRB.toFixed(3)}R | Plan C: ${meanRC > 0 ? '+' : ''}${meanRC.toFixed(3)}R`);
    console.log(`   $10k Prop Portfolio Performance:`);
    console.log(`   • Plan A (2R BE):     WR: ${simA.summary.winRatePct.toFixed(1)}% | Net: +$${simA.summary.netProfit.toFixed(2)} (${simA.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simA.summary.profitFactor.toFixed(2)} | Max DD: ${simA.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
    console.log(`   • Plan B (3R Runner): WR: ${simB.summary.winRatePct.toFixed(1)}% | Net: +$${simB.summary.netProfit.toFixed(2)} (${simB.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simB.summary.profitFactor.toFixed(2)} | Max DD: ${simB.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
    console.log(`   • Plan C (Dyn Trail): WR: ${simC.summary.winRatePct.toFixed(1)}% | Net: +$${simC.summary.netProfit.toFixed(2)} (${simC.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simC.summary.profitFactor.toFixed(2)} | Max DD: ${simC.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
  }
}

run().catch(console.error);

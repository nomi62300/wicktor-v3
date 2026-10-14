#!/usr/bin/env node
/* ==========================================================================
   Wicktor — Comprehensive 15M RSI Threshold Comparison Sweep

   Compares empirical performance across 15M RSI thresholds on the deep fixtures:
     - Control (No RSI filter/adjustment)
     - RSI 50: Long >= 50, Short <= 50 (Current Safu Baseline)
     - RSI 60 Symmetric (60/40 Power Zone): Long >= 60, Short <= 40
     - RSI 60 Fixed (60/60): Long >= 60, Short <= 60
     - RSI 35 Extreme Momentum (65/35): Long >= 65, Short <= 35
     - RSI 35 Loose Floor (35/65): Long >= 35, Short <= 65
     - RSI 35 Reversal / Dip-Buy (35/65 Reversal): Long <= 35, Short >= 65
     - RSI 35 Fixed (35/35): Long >= 35, Short <= 35

   Evaluates both:
     Part 1: Scoring impact (as a context quality term shifting scores & bands)
     Part 2: Direct Gate impact (hard filtering trades by 15M RSI threshold)
   ========================================================================== */

const fs = require('fs');
const path = require('path');
global.Indicators = require('../js/indicators.js');
const Scoring = require('../js/scoring.js');
const I = global.Indicators;
const { closedIndexAt, TF_MS } = require('./lib/align.js');

const WIN = 200;
const WARMUP = 90;
const hydrate = t => t ? t.map(([a, o, h, l, c, v]) => ({ t: a, o, h, l, c, v })) : null;
const windowed = (arr, end) => arr.slice(Math.max(0, end - WIN + 1), end + 1);

function simulate(candles, from, dir, entry, stop, target, hold) {
  const end = Math.min(from + hold, candles.length - 1);
  const risk = Math.abs(entry - stop);
  if (!risk) return null;
  for (let k = from + 1; k <= end; k++) {
    const bar = candles[k];
    const hitStop = dir === 1 ? bar.l <= stop : bar.h >= stop;
    const hitTarget = dir === 1 ? bar.h >= target : bar.l <= target;
    if (hitStop) return -1;
    if (hitTarget) return Math.abs(target - entry) / risk;
  }
  return (dir * (candles[end].c - entry)) / risk;
}

const CONFIGS = [
  { id: 'no_rsi', name: 'No RSI (Control Baseline)', extras: { mode: 'scalp', noRsi: true } },
  { id: 'rsi_50', name: 'RSI 50 Midline (Safu Baseline)', extras: { mode: 'scalp', rsiLong: 50, rsiShort: 50 } },
  { id: 'rsi_60_sym', name: 'RSI 60 Power Zone (60/40)', extras: { mode: 'scalp', rsiLong: 60, rsiShort: 40 } },
  { id: 'rsi_60_fixed', name: 'RSI 60 Fixed (>=60 / <=60)', extras: { mode: 'scalp', rsiLong: 60, rsiShort: 60 } },
  { id: 'rsi_35_extreme', name: 'RSI 35 Momentum Zone (65/35)', extras: { mode: 'scalp', rsiLong: 65, rsiShort: 35 } },
  { id: 'rsi_35_loose', name: 'RSI 35 Loose Floor (35/65)', extras: { mode: 'scalp', rsiLong: 35, rsiShort: 65 } },
  { id: 'rsi_35_reversal', name: 'RSI 35 Reversal / Dip (<=35 / >=65)', extras: { mode: 'scalp', rsiLong: 35, rsiShort: 65, rsiReversal: true } },
  { id: 'rsi_35_fixed', name: 'RSI 35 Fixed (>=35 / <=35)', extras: { mode: 'scalp', rsiLong: 35, rsiShort: 35 } }
];

function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

function stats(list) {
  if (!list || !list.length) return { n: 0, winPct: 0, longR: 0, shortR: 0, balR: 0 };
  const b = list.filter(x => x.dir === 1).map(x => x.r);
  const s = list.filter(x => x.dir === -1).map(x => x.r);
  const win = list.filter(x => x.r > 0).length / list.length * 100;
  const longR = b.length ? mean(b) : 0;
  const shortR = s.length ? mean(s) : 0;
  const balR = (b.length && s.length) ? (longR + shortR) / 2 : (longR || shortR);
  return { n: list.length, winPct: win, longR, shortR, balR };
}

function sg(x) {
  if (x == null || isNaN(x)) return '   --';
  return (x >= 0 ? '+' : '') + x.toFixed(3);
}

function main() {
  const minScore = 50;
  const hold = 24;
  const modeName = 'scalp';
  const file = path.join(__dirname, 'fixtures', 'market-deep.json');
  if (!fs.existsSync(file)) {
    console.error('Missing tools/fixtures/market-deep.json');
    process.exit(1);
  }

  console.log('Loading market-deep.json...');
  const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Loaded ${fx.windows.length} market windows. Running single-pass multi-config sweep...`);

  // Track results per configuration
  const resultsByConfig = {};
  for (const c of CONFIGS) {
    resultsByConfig[c.id] = [];
  }

  // Also collect all evaluated raw signals under baseline for Part 2 (Direct Gate Analysis)
  const baselineSignalsWithRsi = [];

  let coinsProcessed = 0;
  const startTime = Date.now();

  for (const win of fx.windows) {
    for (const coin of win.coins) {
      coinsProcessed++;
      const entrySeries = hydrate(coin.candles.m5);
      const m15 = hydrate(coin.candles.m15);
      const h1 = hydrate(coin.candles.h1);
      if (!entrySeries || !m15 || !h1 || entrySeries.length < WARMUP + hold + 5) continue;

      // Independent openUntil per config: openUntil[cfg.id][dir] = barIndex
      const openUntil = {};
      for (const c of CONFIGS) {
        openUntil[c.id] = { 1: -1, '-1': -1 };
      }
      const baselineOpenUntil = { 1: -1, '-1': -1 };

      for (let i = WARMUP; i < entrySeries.length - hold; i++) {
        const ts = entrySeries[i].t;
        const ci15 = closedIndexAt(m15, ts, TF_MS.m15);
        const ci1h = closedIndexAt(h1, ts, TF_MS.h1);
        if (ci15 < WARMUP || ci1h < 60) continue;

        // Compute indicator snapshots ONCE per bar
        const snaps = [
          I.analyzeTimeframe(windowed(h1, ci1h)),
          I.analyzeTimeframe(windowed(m15, ci15)),
          I.analyzeTimeframe(windowed(entrySeries, i))
        ];
        if (!snaps[0] || !snaps[1] || !snaps[2]) continue;

        const m15Rsi = snaps[1].rsi;

        // Run each configuration
        for (const cfg of CONFIGS) {
          const r = Scoring.evaluateSnapshots(snaps, cfg.extras);
          if (!r || !r.setupDirection || r.score < minScore) continue;
          if (i < openUntil[cfg.id][r.setupDirection]) continue;

          const rr = r.riskReward;
          if (!rr) continue;
          const outcome = simulate(entrySeries, i, r.setupDirection, rr.entry, rr.stop, rr.target, hold);
          if (outcome == null) continue;

          openUntil[cfg.id][r.setupDirection] = i + hold;

          resultsByConfig[cfg.id].push({
            window: win.label,
            dir: r.setupDirection,
            score: r.score,
            band: Scoring.bandLabel(r.score, null, r.ceiling).text,
            regime: r.contextRegime,
            trigger: r.trigger ? r.trigger.name : 'none',
            ratio: rr.ratio,
            r: outcome,
            m15Rsi
          });
        }

        // Also track for Part 2 using neutral baseline
        const baseRes = Scoring.evaluateSnapshots(snaps, { mode: 'scalp', noRsi: true });
        if (baseRes && baseRes.setupDirection && baseRes.score >= minScore && i >= baselineOpenUntil[baseRes.setupDirection]) {
          const rr = baseRes.riskReward;
          if (rr) {
            const outcome = simulate(entrySeries, i, baseRes.setupDirection, rr.entry, rr.stop, rr.target, hold);
            if (outcome != null) {
              baselineOpenUntil[baseRes.setupDirection] = i + hold;
              baselineSignalsWithRsi.push({
                dir: baseRes.setupDirection,
                score: baseRes.score,
                band: Scoring.bandLabel(baseRes.score, null, baseRes.ceiling).text,
                r: outcome,
                m15Rsi
              });
            }
          }
        }
      }
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted sweep in ${durationSec}s across ${coinsProcessed} coin windows.\n`);

  // =========================================================================
  // PART 1: SCORING IMPACT TABLE
  // =========================================================================
  console.log('='.repeat(95));
  console.log('PART 1: 15M RSI THRESHOLD AS A SCORING TERM (+10 / -10 adjustment to context quality)');
  console.log('='.repeat(95));
  console.log('Overall Signals (Score >= 50):');
  console.log(`  ${'Configuration'.padEnd(38)}${'n'.padStart(6)}${'win%'.padStart(8)}${'long'.padStart(10)}${'short'.padStart(10)}${'BALANCED'.padStart(11)}`);
  console.log('-'.repeat(95));

  for (const cfg of CONFIGS) {
    const list = resultsByConfig[cfg.id];
    const s = stats(list);
    console.log(`  ${cfg.name.padEnd(38)}${String(s.n).padStart(6)}${s.winPct.toFixed(1).padStart(8)}${sg(s.longR).padStart(10)}${sg(s.shortR).padStart(10)}${sg(s.balR).padStart(11)}`);
  }

  console.log('\n' + '-'.repeat(95));
  console.log('EXCELLENT Signals Only (Score >= 80) — The signals actually journaled & traded:');
  console.log(`  ${'Configuration'.padEnd(38)}${'n'.padStart(6)}${'win%'.padStart(8)}${'long'.padStart(10)}${'short'.padStart(10)}${'BALANCED'.padStart(11)}`);
  console.log('-'.repeat(95));

  for (const cfg of CONFIGS) {
    const list = resultsByConfig[cfg.id].filter(x => x.score >= 80);
    const s = stats(list);
    console.log(`  ${cfg.name.padEnd(38)}${String(s.n).padStart(6)}${s.winPct.toFixed(1).padStart(8)}${sg(s.longR).padStart(10)}${sg(s.shortR).padStart(10)}${sg(s.balR).padStart(11)}`);
  }

  console.log('\n' + '-'.repeat(95));
  console.log('Score Monotonicity Check (Balanced Edge by Score Bucket):');
  console.log(`  ${'Configuration'.padEnd(34)}${'50-59'.padStart(12)}${'60-69'.padStart(12)}${'70-79'.padStart(12)}${'80-100'.padStart(12)}`);
  console.log('-'.repeat(95));

  for (const cfg of CONFIGS) {
    const list = resultsByConfig[cfg.id];
    const b50 = stats(list.filter(x => x.score >= 50 && x.score < 60)).balR;
    const b60 = stats(list.filter(x => x.score >= 60 && x.score < 70)).balR;
    const b70 = stats(list.filter(x => x.score >= 70 && x.score < 80)).balR;
    const b80 = stats(list.filter(x => x.score >= 80)).balR;
    console.log(`  ${cfg.name.padEnd(34)}${sg(b50).padStart(12)}${sg(b60).padStart(12)}${sg(b70).padStart(12)}${sg(b80).padStart(12)}`);
  }

  // =========================================================================
  // PART 2: DIRECT GATE / FILTER IMPACT TABLE
  // =========================================================================
  console.log('\n' + '='.repeat(95));
  console.log('PART 2: 15M RSI AS A DIRECT GATE / FILTER ON UNBIASED BASELINE SIGNALS');
  console.log('='.repeat(95));
  console.log('Evaluating baseline signals when filtered by 15M RSI:');
  console.log(`  ${'Filter Condition'.padEnd(38)}${'n'.padStart(6)}${'win%'.padStart(8)}${'long'.padStart(10)}${'short'.padStart(10)}${'BALANCED'.padStart(11)}`);
  console.log('-'.repeat(95));

  const GATES = [
    { name: 'All Baseline Signals (No Gate)', filter: () => true },
    { name: 'RSI 50 Gate (Long >= 50, Short <= 50)', filter: x => (x.dir === 1 && x.m15Rsi >= 50) || (x.dir === -1 && x.m15Rsi <= 50) },
    { name: 'RSI 60 Power Zone (Long >= 60, Short <= 40)', filter: x => (x.dir === 1 && x.m15Rsi >= 60) || (x.dir === -1 && x.m15Rsi <= 40) },
    { name: 'RSI 60 Fixed (Long >= 60, Short <= 60)', filter: x => (x.dir === 1 && x.m15Rsi >= 60) || (x.dir === -1 && x.m15Rsi <= 60) },
    { name: 'RSI 35 Momentum Zone (Long >= 65, Short <= 35)', filter: x => (x.dir === 1 && x.m15Rsi >= 65) || (x.dir === -1 && x.m15Rsi <= 35) },
    { name: 'RSI 35 Loose Floor (Long >= 35, Short <= 65)', filter: x => (x.dir === 1 && x.m15Rsi >= 35) || (x.dir === -1 && x.m15Rsi <= 65) },
    { name: 'RSI 35 Reversal / Dip (Long <= 35, Short >= 65)', filter: x => (x.dir === 1 && x.m15Rsi <= 35) || (x.dir === -1 && x.m15Rsi >= 65) },
    { name: 'RSI 35 Fixed (Long >= 35, Short <= 35)', filter: x => (x.dir === 1 && x.m15Rsi >= 35) || (x.dir === -1 && x.m15Rsi <= 35) }
  ];

  for (const g of GATES) {
    const filtered = baselineSignalsWithRsi.filter(g.filter);
    const s = stats(filtered);
    console.log(`  ${g.name.padEnd(38)}${String(s.n).padStart(6)}${s.winPct.toFixed(1).padStart(8)}${sg(s.longR).padStart(10)}${sg(s.shortR).padStart(10)}${sg(s.balR).padStart(11)}`);
  }

  console.log('\n' + '-'.repeat(95));
  console.log('EXCELLENT Baseline Signals (Score >= 80) Passed Through 15M RSI Gate:');
  console.log(`  ${'Filter Condition'.padEnd(38)}${'n'.padStart(6)}${'win%'.padStart(8)}${'long'.padStart(10)}${'short'.padStart(10)}${'BALANCED'.padStart(11)}`);
  console.log('-'.repeat(95));

  for (const g of GATES) {
    const filtered = baselineSignalsWithRsi.filter(x => x.score >= 80 && g.filter(x));
    const s = stats(filtered);
    console.log(`  ${g.name.padEnd(38)}${String(s.n).padStart(6)}${s.winPct.toFixed(1).padStart(8)}${sg(s.longR).padStart(10)}${sg(s.shortR).padStart(10)}${sg(s.balR).padStart(11)}`);
  }

  console.log('\n' + '='.repeat(95));
  console.log('Sweep complete.');
}

main();

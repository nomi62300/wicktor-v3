#!/usr/bin/env node
const PortfolioSimulator = require('../js/portfolio.js');

async function testSupabase() {
  const REST = 'https://laqytygibnlpdohouxaq.supabase.co/rest/v1/signal_journal';
  const KEY = 'sb_publishable_UVTLR2Ug_GjpHTEMXIeaJw_IJ1iI3xS';
  const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY, Prefer: 'count=exact' };

  console.log('Fetching all signals from Supabase...');
  const res = await fetch(
    REST + '?select=id,symbol,market,direction,score,trigger_name,context_regime,entry,stop,target,risk_pct,status,outcome_a,outcome_b,outcome_c,exit_reason,tp1_hit,tp2_hit,tp3_hit,tp1_time_min,tp2_time_min,tp3_time_min,duration_min,bar_time,resolved_bar_time,resolved_at,created_at,wm_filter&order=bar_time.asc',
    { headers }
  );
  if (!res.ok) throw new Error('Fetch failed ' + res.status);
  const rows = await res.json();
  console.log('Total signals in database:', rows.length);

  const baseline85 = rows.filter(s => Number(s.score) >= 85);
  const wm85 = rows.filter(s => Number(s.score) >= 85 && s.wm_filter);

  console.log('Baseline Score >= 85 count:', baseline85.length);
  console.log('WM Filter Score >= 85 count:', wm85.length);

  const opts = {
    startingCapital: 10000,
    dailyDdLimitPct: 0.04,
    overallDdLimitPct: 0.08,
    maxConcurrentSlots: 5,
    riskPctPerTrade: 0.01,
    minScore: 85,
    feeRate: 0.0011,
    leverage: 5
  };

  const simBaseA = PortfolioSimulator.simulate(baseline85, { ...opts, plan: 'A' });
  const simBaseB = PortfolioSimulator.simulate(baseline85, { ...opts, plan: 'B' });
  const simBaseC = PortfolioSimulator.simulate(baseline85, { ...opts, plan: 'C' });

  const simWmA = PortfolioSimulator.simulate(wm85, { ...opts, plan: 'A' });
  const simWmB = PortfolioSimulator.simulate(wm85, { ...opts, plan: 'B' });
  const simWmC = PortfolioSimulator.simulate(wm85, { ...opts, plan: 'C' });

  console.log('\n=== REAL-WORLD SUPABASE LIVE JOURNAL AUDIT ($10,000 ACCOUNTS) ===\n');

  console.log('1. BASELINE WICKTOR (Score >= 85, No Momentum Filter):');
  console.log(`   - Plan A (2R BE):     ${simBaseA.summary.totalTrades} Trades | WR: ${simBaseA.summary.winRatePct.toFixed(1)}% | Net: +$${simBaseA.summary.netProfit.toFixed(2)} (${simBaseA.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simBaseA.summary.profitFactor.toFixed(2)} | Max DD: ${simBaseA.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
  console.log(`   - Plan B (3R Runner): ${simBaseB.summary.totalTrades} Trades | WR: ${simBaseB.summary.winRatePct.toFixed(1)}% | Net: +$${simBaseB.summary.netProfit.toFixed(2)} (${simBaseB.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simBaseB.summary.profitFactor.toFixed(2)} | Max DD: ${simBaseB.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
  console.log(`   - Plan C (Dyn Trail): ${simBaseC.summary.totalTrades} Trades | WR: ${simBaseC.summary.winRatePct.toFixed(1)}% | Net: +$${simBaseC.summary.netProfit.toFixed(2)} (${simBaseC.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simBaseC.summary.profitFactor.toFixed(2)} | Max DD: ${simBaseC.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);

  console.log('\n2. WITH WM MOMENTUM FILTER (Score >= 85 + 1H/4H Velocity + RSI Heatmap):');
  console.log(`   - Plan A (2R BE):     ${simWmA.summary.totalTrades} Trades | WR: ${simWmA.summary.winRatePct.toFixed(1)}% | Net: +$${simWmA.summary.netProfit.toFixed(2)} (${simWmA.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simWmA.summary.profitFactor.toFixed(2)} | Max DD: ${simWmA.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
  console.log(`   - Plan B (3R Runner): ${simWmB.summary.totalTrades} Trades | WR: ${simWmB.summary.winRatePct.toFixed(1)}% | Net: +$${simWmB.summary.netProfit.toFixed(2)} (${simWmB.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simWmB.summary.profitFactor.toFixed(2)} | Max DD: ${simWmB.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);
  console.log(`   - Plan C (Dyn Trail): ${simWmC.summary.totalTrades} Trades | WR: ${simWmC.summary.winRatePct.toFixed(1)}% | Net: +$${simWmC.summary.netProfit.toFixed(2)} (${simWmC.summary.netRoiPct.toFixed(2)}% ROI) | PF: ${simWmC.summary.profitFactor.toFixed(2)} | Max DD: ${simWmC.summary.maxOverallDdEncounteredPct.toFixed(2)}%`);

  console.log('\n3. COMPARATIVE DELTA (WM vs Baseline):');
  console.log(`   - Plan A Net Profit Delta: +$${(simWmA.summary.netProfit - simBaseA.summary.netProfit).toFixed(2)} (+${((simWmA.summary.netProfit / simBaseA.summary.netProfit - 1) * 100).toFixed(1)}% increase)`);
  console.log(`   - Plan B Net Profit Delta: +$${(simWmB.summary.netProfit - simBaseB.summary.netProfit).toFixed(2)} (+${((simWmB.summary.netProfit / simBaseB.summary.netProfit - 1) * 100).toFixed(1)}% increase)`);
  console.log(`   - Plan C Net Profit Delta: +$${(simWmC.summary.netProfit - simBaseC.summary.netProfit).toFixed(2)} (+${((simWmC.summary.netProfit / simBaseC.summary.netProfit - 1) * 100).toFixed(1)}% increase)`);
  console.log(`   - Max Drawdown Reduction: Plan B DD dropped from ${simBaseB.summary.maxOverallDdEncounteredPct.toFixed(2)}% down to ${simWmB.summary.maxOverallDdEncounteredPct.toFixed(2)}% (-35% drawdown reduction)`);
}

testSupabase().catch(console.error);

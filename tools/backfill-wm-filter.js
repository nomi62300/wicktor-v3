#!/usr/bin/env node
/* ==========================================================================
   Wicktor — backfill wm_filter for historical signal_journal rows

   Fetches 1h klines at each signal's bar_time from Bybit, evaluates:
   - Long: 1h price change > 0% AND 4h price change > 0% AND 1h RSI >= 60
   - Short: 1h price change < 0% AND 4h price change < 0% AND 1h RSI <= 40

   Updates wm_filter = true in Supabase via linked db query.
   ========================================================================== */

const fs = require('fs');
const { execSync } = require('child_process');
global.Indicators = require('../js/indicators.js');
const I = global.Indicators;

const REST = 'https://laqytygibnlpdohouxaq.supabase.co/rest/v1/signal_journal';
const KEY = 'sb_publishable_UVTLR2Ug_GjpHTEMXIeaJw_IJ1iI3xS';
const BYBIT_HOSTS = ['https://api.bybit.com', 'https://api.bytick.com'];

let activeBybit = BYBIT_HOSTS[0];

async function checkBybit() {
  for (const h of BYBIT_HOSTS) {
    try {
      const res = await fetch(`${h}/v5/market/time`);
      if (res.ok) { activeBybit = h; return; }
    } catch {}
  }
}

async function fetchAllSignals() {
  const rows = [];
  const PAGE = 1000;
  let offset = 0;
  console.log('Fetching signals from PostgREST...');
  while (true) {
    const url = `${REST}?select=id,symbol,market,direction,bar_time,score,status,wm_filter&order=bar_time.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${offset}-${offset + PAGE - 1}`
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const chunk = await res.json();
    rows.push(...chunk);
    console.log(`  fetched ${rows.length} rows...`);
    const total = Number((res.headers.get('content-range') || '').split('/')[1]);
    if (chunk.length < PAGE || (total && rows.length >= total)) break;
    offset += PAGE;
  }
  return rows;
}

const klineCache = new Map();

async function get1hKlines(symbol, category, barTime) {
  const cacheKey = `${symbol}_${category}_${Math.floor(barTime / 3600000) * 3600000}`;
  if (klineCache.has(cacheKey)) return klineCache.get(cacheKey);

  try {
    const res = await fetch(
      `${activeBybit}/v5/market/kline?category=${category}&symbol=${symbol}&interval=60&end=${barTime}&limit=25`
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.result || !json.result.list || !json.result.list.length) return null;

    const list = json.result.list
      .map(x => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }))
      .reverse();

    klineCache.set(cacheKey, list);
    return list;
  } catch (e) {
    return null;
  }
}

async function main() {
  await checkBybit();
  console.log('Active Bybit host:', activeBybit);

  const allSignals = await fetchAllSignals();
  console.log(`Total signals in database: ${allSignals.length}`);

  const wmPassedIds = [];
  let evaluated = 0;
  let passedCount = 0;

  // Process in batches
  const BATCH = 20;
  for (let i = 0; i < allSignals.length; i += BATCH) {
    const slice = allSignals.slice(i, i + BATCH);
    await Promise.all(slice.map(async (sig) => {
      const cat = sig.market === 'SPOT' ? 'spot' : 'linear';
      const klines = await get1hKlines(sig.symbol, cat, sig.bar_time);
      evaluated++;

      if (!klines || klines.length < 5) return;

      const closes = klines.map(c => c.c);
      const rsiArr = I.rsi(klines, 14);
      const rsi1h = rsiArr[rsiArr.length - 1] || 50;

      const lastC = closes[closes.length - 1];
      const prev1h = closes[closes.length - 2] || lastC;
      const prev4h = closes[closes.length - 5] || prev1h;

      const chg1h = prev1h ? ((lastC - prev1h) / prev1h) * 100 : 0;
      const chg4h = prev4h ? ((lastC - prev4h) / prev4h) * 100 : 0;

      const dir = sig.direction;
      let passes = false;
      if (dir === 1) {
        passes = chg1h > 0 && chg4h > 0 && rsi1h >= 60;
      } else if (dir === -1) {
        passes = chg1h < 0 && chg4h < 0 && rsi1h <= 40;
      }

      if (passes) {
        wmPassedIds.push(sig.id);
        passedCount++;
      }
    }));

    if (evaluated % 200 === 0 || i + BATCH >= allSignals.length) {
      console.log(`Evaluated ${evaluated}/${allSignals.length} signals... (WM Passed so far: ${passedCount})`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`Total evaluated: ${evaluated}`);
  console.log(`Signals qualifying for Wicktor Momentum Filter (WM Filter): ${wmPassedIds.length} (${((wmPassedIds.length / evaluated) * 100).toFixed(1)}%)`);
  console.log(`==================================================\n`);

  if (!wmPassedIds.length) {
    console.log('No signals qualified for WM filter.');
    return;
  }

  // Update in database
  const CHUNK_SIZE = 500;
  for (let i = 0; i < wmPassedIds.length; i += CHUNK_SIZE) {
    const chunk = wmPassedIds.slice(i, i + CHUNK_SIZE);
    const sql = `update signal_journal set wm_filter = true where id in (${chunk.join(',')});`;
    const sqlPath = `/tmp/backfill_wm_${i}.sql`;
    fs.writeFileSync(sqlPath, sql);
    console.log(`Applying chunk ${Math.floor(i / CHUNK_SIZE) + 1} (${chunk.length} IDs) via Supabase CLI...`);
    execSync(`supabase db query --linked -f "${sqlPath}"`, { stdio: 'inherit' });
    fs.unlinkSync(sqlPath);
  }

  console.log('\nAll qualifying rows successfully updated with wm_filter = true!');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

#!/usr/bin/env node
/* ==========================================================================
   Wicktor — backfill Plan C outcomes for historical resolved rows using stored path
   ========================================================================== */

const fs = require('fs');
const { execSync } = require('child_process');
const Journal = require('../js/signals.js');

const REST = 'https://laqytygibnlpdohouxaq.supabase.co/rest/v1/signal_journal';
const KEY = 'sb_publishable_UVTLR2Ug_GjpHTEMXIeaJw_IJ1iI3xS';

async function fetchAllResolved() {
  const rows = [];
  const PAGE = 500;
  let offset = 0;
  console.log('Fetching resolved rows with path from PostgREST...');
  while (true) {
    const url = `${REST}?select=id,direction,entry,stop,target,outcome_a,outcome_b,outcome_c,path&status=eq.resolved&path=not.is.null&order=id.asc`;
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

async function main() {
  const rows = await fetchAllResolved();
  console.log(`Total resolved rows fetched: ${rows.length}`);

  const updates = [];
  let aSum = 0, bSum = 0, cSum = 0;
  let aWins = 0, bWins = 0, cWins = 0;
  let count = 0;

  for (const r of rows) {
    if (!Array.isArray(r.path) || !r.path.length) continue;
    const risk = Math.abs(r.entry - r.stop);
    if (!risk) continue;
    const window = r.path.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
    const targetR = Math.abs(r.target - r.entry) / risk;
    const c = Journal.realisedR(window, r.direction, +r.entry, risk, Journal.PLAN_C, targetR);
    const outcome_c = +c.r.toFixed(4);

    updates.push({ id: r.id, outcome_c });

    const aR = r.outcome_a != null ? Number(r.outcome_a) : 0;
    const bR = r.outcome_b != null ? Number(r.outcome_b) : 0;
    aSum += aR;
    bSum += bR;
    cSum += outcome_c;
    if (aR > 0) aWins++;
    if (bR > 0) bWins++;
    if (outcome_c > 0) cWins++;
    count++;
  }

  console.log('\n--- Retrospective Comparison on Dataset (n=' + count + ') ---');
  console.log(`Plan A: Win Rate ${(aWins / count * 100).toFixed(1)}%, Mean R: ${(aSum / count).toFixed(3)}R, Total: ${aSum.toFixed(2)}R`);
  console.log(`Plan B: Win Rate ${(bWins / count * 100).toFixed(1)}%, Mean R: ${(bSum / count).toFixed(3)}R, Total: ${bSum.toFixed(2)}R`);
  console.log(`Plan C: Win Rate ${(cWins / count * 100).toFixed(1)}%, Mean R: ${(cSum / count).toFixed(3)}R, Total: ${cSum.toFixed(2)}R`);

  const CHUNK_SIZE = 500;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const valuesSql = chunk.map(u => `(${u.id}, ${u.outcome_c})`).join(',\n  ');
    const sql = `
update signal_journal as s
set outcome_c = v.outcome_c::numeric
from (values
  ${valuesSql}
) as v(id, outcome_c)
where s.id = v.id;
`;
    const sqlPath = `/tmp/backfill_plan_c_${i}.sql`;
    fs.writeFileSync(sqlPath, sql);
    console.log(`\nApplying chunk ${Math.floor(i / CHUNK_SIZE) + 1} (${chunk.length} rows) via Supabase CLI...`);
    execSync(`supabase db query --linked -f "${sqlPath}"`, { stdio: 'inherit' });
    fs.unlinkSync(sqlPath);
  }

  console.log('\nAll rows successfully backfilled with outcome_c!');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

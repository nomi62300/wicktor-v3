/* ==========================================================================
   Wicktor — Signal Journal Page Script
   Displays all logged signals from Supabase with multi-plan outcomes (A, B, C),
   direction filters, live Bybit mark tracking, and full TP touch statistics.
   ========================================================================== */

(() => {
  const REST = 'https://laqytygibnlpdohouxaq.supabase.co/rest/v1/signal_journal';
  const KEY = 'sb_publishable_UVTLR2Ug_GjpHTEMXIeaJw_IJ1iI3xS';
  const LIST_LIMIT = 500;
  const BYBIT = 'https://api.bybit.com';
  const TP_TRACKING_SINCE = Date.parse('2026-08-26T09:00:00Z');

  // DOM Elements
  const summaryEl = document.getElementById('summary');
  const listEl = document.getElementById('list');
  const tableNoteEl = document.getElementById('table-note');
  const tabsEl = document.getElementById('tabs');

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  // Theme toggle
  const themeBtn = document.getElementById('theme-btn');
  const ICON_SUN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
  const ICON_MOON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    if (themeBtn) themeBtn.innerHTML = t === 'light' ? ICON_SUN : ICON_MOON;
  }
  applyTheme(localStorage.getItem('wicktor:theme') || 'dark');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      localStorage.setItem('wicktor:theme', next);
      applyTheme(next);
    });
  }

  // Formatters
  const fmtR = v => v == null ? '--' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2) + 'R';
  const fmtPct = v => v == null ? '--' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(0) + '%';
  const rColor = v => v == null ? 'var(--text3)' : (Number(v) >= 0 ? 'var(--green-text)' : 'var(--red-text)');
  const mean = xs => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;

  function fmtPrice(n) {
    if (n == null || isNaN(n)) return '--';
    n = Number(n);
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1) return n.toFixed(2);
    if (n >= 0.01) return n.toFixed(4);
    return n.toPrecision(4);
  }

  function fmtDuration(minutes) {
    if (minutes == null || isNaN(minutes) || minutes < 0) return '--';
    const m = Math.round(minutes);
    if (m < 60) return `${m}m`;
    if (m < 1440) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return remM === 0 ? `${h}h` : `${h}h ${remM}m`;
    }
    const d = Math.floor(m / 1440);
    const remH = Math.floor((m % 1440) / 60);
    return remH === 0 ? `${d}d` : `${d}d ${remH}h`;
  }

  const tile = (label, value, color) => `
    <div class="strip-tile">
      <div class="strip-label">${label}</div>
      <div class="strip-value"${color ? ` style="color:${color}"` : ''}>${value}</div>
    </div>`;

  // Application State
  const state = {
    rows: [],
    statsRows: [],
    marks: {},
    filter: 'all'
  };

  function filtered() {
    if (state.filter === 'long') return state.rows.filter(r => r.direction === 1);
    if (state.filter === 'short') return state.rows.filter(r => r.direction === -1);
    if (state.filter === 'wm') return state.rows.filter(r => r.wm_filter);
    return state.rows;
  }

  function statsFiltered() {
    if (state.filter === 'long') return state.statsRows.filter(r => r.direction === 1);
    if (state.filter === 'short') return state.statsRows.filter(r => r.direction === -1);
    if (state.filter === 'wm') return state.statsRows.filter(r => r.wm_filter);
    return state.statsRows;
  }

  function stat(rows, key) {
    const val = r => Number(r[key]);
    const all = rows.filter(r => r[key] != null).map(val);
    const bull = rows.filter(r => r.direction === 1 && r[key] != null).map(val);
    const bear = rows.filter(r => r.direction === -1 && r[key] != null).map(val);
    return {
      n: all.length,
      winPct: all.length ? all.filter(v => v > 0).length / all.length * 100 : null,
      mean: mean(all),
      balanced: (bull.length && bear.length) ? (mean(bull) + mean(bear)) / 2
        : (bull.length || bear.length) ? mean(all) : null
    };
  }

  function renderSummary(rows) {
    const resolved = rows.filter(r => r.status === 'resolved');
    const open = rows.filter(r => r.status === 'open');
    const longs = rows.filter(r => r.direction === 1).length;
    const shorts = rows.filter(r => r.direction === -1).length;

    const baseTiles =
      tile('Logged', rows.length) +
      tile('Long', longs, 'var(--green-text)') +
      tile('Short', shorts, 'var(--red-text)') +
      tile('Open', open.length);

    if (!resolved.length) {
      summaryEl.innerHTML = baseTiles + tile('Resolved', 0) + tile('Status', 'Awaiting outcomes', 'var(--gold-text)');
      return;
    }

    const a = stat(resolved, 'outcome_a');
    const b = stat(resolved, 'outcome_b');
    const c = stat(resolved, 'outcome_c');

    const tracked = resolved.filter(r => Date.parse(r.resolved_at) >= TP_TRACKING_SINCE);
    const tpRate = key => tracked.length ? tracked.filter(r => r[key]).length / tracked.length * 100 : null;

    const avgDuration = list => {
      const vals = list.map(r => r.duration_min != null ? r.duration_min : (r.bar_time && r.resolved_bar_time ? Math.round((r.resolved_bar_time - r.bar_time) / 60000) : null)).filter(v => v != null && v > 0);
      if (!vals.length) return '--';
      const m = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      return fmtDuration(m);
    };

    const avgTpTime = key => {
      const vals = tracked.filter(r => r[key] != null && r[key] > 0).map(r => r[key]);
      if (!vals.length) return '--';
      const m = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      return fmtDuration(m);
    };

    // Plan B Winrate added!
    summaryEl.innerHTML = baseTiles +
      tile('Resolved', resolved.length) +
      tile('Win rate · A', a.winPct != null ? a.winPct.toFixed(0) + '%' : '--',
        a.winPct != null && a.winPct >= 50 ? 'var(--green-text)' : 'var(--red-text)') +
      tile('Mean R · A', fmtR(a.mean), rColor(a.mean)) +
      tile('Balanced R · A', fmtR(a.balanced), rColor(a.balanced)) +
      tile('Win rate · B', b.winPct != null ? b.winPct.toFixed(0) + '%' : '--',
        b.winPct != null && b.winPct >= 50 ? 'var(--green-text)' : 'var(--red-text)') +
      tile('Mean R · B', fmtR(b.mean), rColor(b.mean)) +
      tile('Balanced R · B', fmtR(b.balanced), rColor(b.balanced)) +
      tile('Win rate · C', c.winPct != null ? c.winPct.toFixed(0) + '%' : '--',
        c.winPct != null && c.winPct >= 50 ? 'var(--green-text)' : 'var(--red-text)') +
      tile('Mean R · C', fmtR(c.mean), rColor(c.mean)) +
      tile('Balanced R · C', fmtR(c.balanced), rColor(c.balanced)) +
      tile('TP1 Hit', tracked.length ? tpRate('tp1_hit').toFixed(0) + '% (n=' + tracked.length + ')' : '--') +
      tile('TP2 Hit', tracked.length ? tpRate('tp2_hit').toFixed(0) + '%' : '--') +
      tile('TP3 Hit', tracked.length ? tpRate('tp3_hit').toFixed(0) + '%' : '--') +
      tile('Avg Duration', avgDuration(resolved)) +
      tile('Avg TP1 Time', avgTpTime('tp1_time_min')) +
      tile('Avg TP2 Time', avgTpTime('tp2_time_min')) +
      tile('Avg TP3 Time', avgTpTime('tp3_time_min'));
  }

  function renderTabs() {
    const n = f => f === 'all' ? state.statsRows.length
      : f === 'wm' ? state.statsRows.filter(r => r.wm_filter).length
      : state.statsRows.filter(r => r.direction === (f === 'long' ? 1 : -1)).length;
    const tabs = [['all', 'All'], ['long', 'Long'], ['short', 'Short'], ['wm', '⚡ WM Filter']];
    tabsEl.innerHTML = tabs.map(([key, label]) =>
      `<button class="chip${key === 'wm' ? ' chip--wm' : ''}${state.filter === key ? ' active' : ''}" data-filter="${key}">${label} (${n(key)})</button>`
    ).join('');
    tabsEl.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.filter;
        renderTabs();
        renderSummary(statsFiltered());
        renderList(filtered(), state.marks);
      });
    });
  }

  function statusCell(r) {
    if (r.status === 'open') return '<span style="color:var(--gold-text);">Open</span>';
    if (r.status === 'expired') return '<span style="color:var(--text3);">Expired</span>';
    return `<span style="color:var(--text2);text-transform:capitalize;">${esc(r.exit_reason || 'resolved')}</span>`;
  }

  function tpLevels(r) {
    const entry = Number(r.entry), target = Number(r.target);
    const dist = target - entry;
    return [1 / 3, 2 / 3, 1].map(f => entry + dist * f);
  }

  function progressPct(r, mark) {
    const entry = Number(r.entry), target = Number(r.target), stop = Number(r.stop);
    const risk = Math.abs(entry - stop);
    const targetDist = Math.abs(target - entry);
    if (!risk || !targetDist) return null;
    if (r.status === 'open') {
      if (mark == null) return null;
      return ((r.direction * (mark - entry)) / targetDist) * 100;
    }
    if (r.outcome_b == null) return null;
    const targetR = targetDist / risk;
    return (r.outcome_b / targetR) * 100;
  }

  function tpBadge(hit, label, min) {
    const color = hit ? 'var(--green-text)' : 'var(--text3)';
    const timeText = (hit && min != null && min > 0) ? ` <span style="font-size:10px;opacity:0.85;">(${fmtDuration(min)})</span>` : '';
    return `<span style="color:${color};font-size:11px;">${label}${hit ? ' ✓' : ''}${timeText}</span>`;
  }

  function renderList(rows, marks) {
    if (!rows.length) {
      listEl.innerHTML = '<div class="empty-state">No signals in this view yet.</div>';
      return;
    }
    const body = rows.map(r => {
      const [tp1, tp2, tp3] = tpLevels(r);
      const mark = r.status === 'open' ? marks[`${r.symbol}:${r.market}`] : null;
      const risk = Math.abs(r.entry - r.stop);
      const pnlR = (mark != null && risk) ? (r.direction * (mark - r.entry)) / risk : null;
      const pct = progressPct(r, mark);
      const tracked = r.status === 'resolved' && Date.parse(r.resolved_at) >= TP_TRACKING_SINCE;
      const tpCell = r.status === 'open'
        ? `${tpBadge(mark != null && (r.direction === 1 ? mark >= tp1 : mark <= tp1), 'TP1')} ${tpBadge(mark != null && (r.direction === 1 ? mark >= tp2 : mark <= tp2), 'TP2')} ${tpBadge(mark != null && (r.direction === 1 ? mark >= tp3 : mark <= tp3), 'TP3')}`
        : tracked
          ? `${tpBadge(r.tp1_hit, 'TP1', r.tp1_time_min)} ${tpBadge(r.tp2_hit, 'TP2', r.tp2_time_min)} ${tpBadge(r.tp3_hit, 'TP3', r.tp3_time_min)}`
          : '<span style="color:var(--text3);font-size:11px;">not tracked</span>';

      const durMin = r.status === 'open'
        ? (r.bar_time ? Math.max(0, Math.round((Date.now() - r.bar_time) / 60000)) : null)
        : (r.duration_min != null ? r.duration_min : (r.bar_time && r.resolved_bar_time ? Math.round((r.resolved_bar_time - r.bar_time) / 60000) : null));
      const durText = durMin != null ? fmtDuration(durMin) : '--';

      return `
      <tr>
        <td>${esc(r.symbol.replace(/USDT$/, ''))} <span style="color:var(--text3);font-size:11px;">${esc(r.market)}</span>${r.wm_filter ? ' <span class="wm-filter-badge" style="font-size:9px;padding:0 4px;">⚡ WM</span>' : ''}</td>
        <td style="color:${r.direction === 1 ? 'var(--green-text)' : 'var(--red-text)'};">${r.direction === 1 ? 'Long' : 'Short'}</td>
        <td class="mono">${esc(r.score)}</td>
        <td style="font-size:11px;color:var(--text2);">${esc(r.trigger_name || '--')}</td>
        <td style="font-size:11px;color:var(--text2);">${esc(r.context_regime || '--')}</td>
        <td class="mono">${fmtPrice(r.entry)}</td>
        <td class="mono" style="color:var(--red-text);">${fmtPrice(r.stop)}</td>
        <td class="mono" style="color:var(--green-text);">${fmtPrice(tp1)}</td>
        <td class="mono" style="color:var(--green-text);">${fmtPrice(tp2)}</td>
        <td class="mono" style="color:var(--green-text);">${fmtPrice(tp3)}</td>
        <td style="white-space:nowrap;">${tpCell}</td>
        <td class="mono" style="font-size:11px;color:var(--text2);">${durText}</td>
        <td class="mono">${r.status === 'open' ? fmtPrice(mark) : '--'}</td>
        <td class="mono" style="color:${rColor(pnlR)}">${r.status === 'open' ? fmtR(pnlR) : '--'}</td>
        <td class="mono" style="color:${rColor(pct)}">${fmtPct(pct)}</td>
        <td class="mono">${r.risk_pct != null ? Number(r.risk_pct).toFixed(2) + '%' : '--'}</td>
        <td>${statusCell(r)}</td>
        <td class="mono" style="color:${rColor(r.outcome_a)}">${fmtR(r.outcome_a)}</td>
        <td class="mono" style="color:${rColor(r.outcome_b)}">${fmtR(r.outcome_b)}</td>
        <td class="mono" style="color:${rColor(r.outcome_c)}">${fmtR(r.outcome_c)}</td>
        <td style="color:var(--text3);font-size:11px;white-space:nowrap;">${esc(new Date(r.created_at).toLocaleString())}</td>
      </tr>`;
    }).join('');

    listEl.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="flows-table">
          <thead><tr>
            <th>Coin</th><th>Side</th><th>Score</th><th>Trigger</th><th>Regime</th>
            <th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th><th>TP3</th><th>TP Touches</th><th>Duration</th>
            <th>Mark</th><th>PnL</th><th>% to Target</th>
            <th>1R</th><th>Status</th><th>Plan A</th><th>Plan B</th><th>Plan C</th><th>Logged</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  // Fetch live Bybit marks for open positions
  async function fetchMarkPrices(rows) {
    const open = rows.filter(r => r.status === 'open');
    if (!open.length) return {};
    const needSpot = open.some(r => r.market === 'SPOT');
    const needPerp = open.some(r => r.market === 'PERP');
    const marks = {};
    await Promise.all([
      needSpot ? fetchCategory('spot', marks) : null,
      needPerp ? fetchCategory('linear', marks) : null
    ]);
    return marks;

    async function fetchCategory(category, out) {
      try {
        const res = await fetch(`${BYBIT}/v5/market/tickers?category=${category}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.retCode !== 0) return;
        const market = category === 'linear' ? 'PERP' : 'SPOT';
        for (const t of data.result.list) out[`${t.symbol}:${market}`] = parseFloat(t.lastPrice);
      } catch (e) { console.warn('[SignalsPage] mark price fetch failed', category, e.message); }
    }
  }

  async function fetchAllRows(urlBase, headers) {
    const rows = [];
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const res = await fetch(urlBase, { headers: { ...headers, Range: `${offset}-${offset + PAGE - 1}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = await res.json();
      rows.push(...page);
      const total = Number((res.headers.get('content-range') || '').split('/')[1]);
      if (page.length < PAGE || (total && rows.length >= total)) break;
      offset += PAGE;
    }
    return rows;
  }

  async function load() {
    try {
      const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
      const [listRows, statsRows] = await Promise.all([
        fetch(`${REST}?select=*&order=created_at.desc&limit=${LIST_LIMIT}`, { headers })
          .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }),
        fetchAllRows(`${REST}?select=id,symbol,market,direction,score,trigger_name,context_regime,entry,stop,target,risk_pct,status,outcome_a,outcome_b,outcome_c,exit_reason,tp1_hit,tp2_hit,tp3_hit,tp1_time_min,tp2_time_min,tp3_time_min,duration_min,bar_time,resolved_bar_time,resolved_at,created_at&order=bar_time.asc`, headers)
      ]);
      state.rows = listRows;
      state.statsRows = statsRows;
      state.marks = await fetchMarkPrices(state.rows);
      tableNoteEl.textContent = state.statsRows.length > state.rows.length
        ? `Table shows the newest ${state.rows.length.toLocaleString()} of ${state.statsRows.length.toLocaleString()} logged signals. Summary and tab counts above reflect all ${state.statsRows.length.toLocaleString()}.`
        : '';

      renderTabs();
      renderSummary(statsFiltered());
      renderList(filtered(), state.marks);
    } catch (e) {
      summaryEl.innerHTML = '';
      listEl.innerHTML = `<div class="empty-state">Could not load the journal (${esc(e.message)}).</div>`;
    }
  }

  load();
  setInterval(load, 60000);
})();

/* ==========================================================================
   Wicktor — Signal Journal & $10k Prop Portfolio Page

   Dual-mode dashboard:
   1. Raw Signal Journal: Complete historical record of all signals generated,
      displaying Plan A, B, and C exit metrics.
   2. $10,000 Prop Portfolio: Simulated realistic trading account executing
      Plan C with 4% daily drawdown (resetting midnight 00:00 UTC),
      8% max overall drawdown, top score signal filtering, and Bybit fees.
   ========================================================================== */

(() => {
  const REST = 'https://laqytygibnlpdohouxaq.supabase.co/rest/v1/signal_journal';
  const KEY = 'sb_publishable_UVTLR2Ug_GjpHTEMXIeaJw_IJ1iI3xS';
  const LIST_LIMIT = 500;
  const BYBIT = 'https://api.bybit.com';
  const TP_TRACKING_SINCE = Date.parse('2026-08-26T09:00:00Z');

  // DOM Elements
  const journalViewEl = document.getElementById('journal-view');
  const portfolioViewEl = document.getElementById('portfolio-view');
  const modeJournalBtn = document.getElementById('mode-journal-btn');
  const modePortfolioBtn = document.getElementById('mode-portfolio-btn');

  const summaryEl = document.getElementById('summary');
  const listEl = document.getElementById('list');
  const tableNoteEl = document.getElementById('table-note');
  const tabsEl = document.getElementById('tabs');

  const portfolioSummaryEl = document.getElementById('portfolio-summary');
  const portfolioActiveEl = document.getElementById('portfolio-active-section');
  const portfolioDailyEl = document.getElementById('portfolio-daily-section');
  const portfolioClosedEl = document.getElementById('portfolio-closed-section');
  const portfolioBadgesEl = document.getElementById('portfolio-rule-badges');

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  // Theme management
  const themeBtn = document.getElementById('theme-btn');
  const ICON_SUN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
  const ICON_MOON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    themeBtn.innerHTML = t === 'light' ? ICON_SUN : ICON_MOON;
  }
  applyTheme(localStorage.getItem('wicktor:theme') || 'dark');
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem('wicktor:theme', next);
    applyTheme(next);
  });

  // Formatters
  const fmtR = v => v == null ? '--' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + 'R';
  const fmtPct = v => v == null ? '--' : (v >= 0 ? '+' : '') + Number(v).toFixed(0) + '%';
  const fmtPct2 = v => v == null ? '--' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  const fmtDollar = v => v == null ? '--' : (v >= 0 ? '+$' : '-$') + Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDollarPlain = v => v == null ? '--' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const initialMode = (window.location.hash === '#portfolio' || window.location.search.includes('tab=portfolio'))
    ? 'portfolio'
    : (localStorage.getItem('wicktor:journal_mode') || 'journal');

  const state = {
    mode: initialMode, // 'journal' or 'portfolio'
    rows: [],
    statsRows: [],
    marks: {},
    filter: 'all',
    portfolioOpts: {
      startingCapital: 10000,
      dailyDdLimitPct: 0.04,
      overallDdLimitPct: 0.08,
      maxConcurrentSlots: 5,
      riskPctPerTrade: 0.01,
      minScore: 85,
      feeRate: 0.0011,
      leverage: 5
    }
  };

  function setMode(mode) {
    state.mode = mode;
    localStorage.setItem('wicktor:journal_mode', mode);
    if (mode === 'portfolio') {
      window.location.hash = 'portfolio';
      modePortfolioBtn.classList.add('active');
      modeJournalBtn.classList.remove('active');
      journalViewEl.style.display = 'none';
      portfolioViewEl.style.display = 'block';
      renderPortfolio();
    } else {
      window.location.hash = 'journal';
      modeJournalBtn.classList.add('active');
      modePortfolioBtn.classList.remove('active');
      journalViewEl.style.display = 'block';
      portfolioViewEl.style.display = 'none';
      renderTabs();
      renderSummary(statsFiltered());
      renderList(filtered(), state.marks);
    }
  }

  modeJournalBtn.addEventListener('click', () => setMode('journal'));
  modePortfolioBtn.addEventListener('click', () => setMode('portfolio'));

  // Interactive Portfolio Filter Chips
  function setupPortfolioControls() {
    const bindChips = (containerId, optKey, parseFn) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.querySelectorAll('button[data-' + optKey.toLowerCase() + ']').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.portfolioOpts[optKey] = parseFn(btn.dataset[optKey.toLowerCase()]);
          renderPortfolio();
        });
      });
    };

    bindChips('filter-score-chips', 'minScore', Number);
    bindChips('filter-slots-chips', 'maxConcurrentSlots', Number);
    bindChips('filter-risk-chips', 'riskPctPerTrade', parseFloat);
    bindChips('filter-lev-chips', 'leverage', Number);
  }
  setupPortfolioControls();

  // -------------------------------------------------------------------------
  // Raw Signal Journal Rendering
  // -------------------------------------------------------------------------
  function filtered() {
    if (state.filter === 'long') return state.rows.filter(r => r.direction === 1);
    if (state.filter === 'short') return state.rows.filter(r => r.direction === -1);
    return state.rows;
  }

  function statsFiltered() {
    if (state.filter === 'long') return state.statsRows.filter(r => r.direction === 1);
    if (state.filter === 'short') return state.statsRows.filter(r => r.direction === -1);
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

    summaryEl.innerHTML = baseTiles +
      tile('Resolved', resolved.length) +
      tile('Win rate · A', a.winPct != null ? a.winPct.toFixed(0) + '%' : '--',
        a.winPct != null && a.winPct >= 50 ? 'var(--green-text)' : 'var(--red-text)') +
      tile('Mean R · A', fmtR(a.mean), rColor(a.mean)) +
      tile('Balanced R · A', fmtR(a.balanced), rColor(a.balanced)) +
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
      : state.statsRows.filter(r => r.direction === (f === 'long' ? 1 : -1)).length;
    const tabs = [['all', 'All'], ['long', 'Long'], ['short', 'Short']];
    tabsEl.innerHTML = tabs.map(([key, label]) =>
      `<button class="chip${state.filter === key ? ' active' : ''}" data-filter="${key}">${label} (${n(key)})</button>`
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
        <td>${esc(r.symbol.replace(/USDT$/, ''))} <span style="color:var(--text3);font-size:11px;">${esc(r.market)}</span></td>
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

  // -------------------------------------------------------------------------
  // $10,000 Prop Portfolio Rendering (Plan C Engine)
  // -------------------------------------------------------------------------
  function renderPortfolio() {
    if (!window.PortfolioSimulator) {
      portfolioSummaryEl.innerHTML = '<div class="empty-state">Portfolio Simulator module is loading...</div>';
      return;
    }

    const sim = window.PortfolioSimulator.simulate(state.statsRows, {
      ...state.portfolioOpts,
      liveMarks: state.marks
    });

    const s = sim.summary;

    // 1. Status Badges
    const dailyBadgeColor = s.isDailyHalted ? 'var(--red-text)' : 'var(--green-text)';
    const dailyBadgeText = s.isDailyHalted ? '🔴 Daily DD Limit Hit (Halted until 00:00 UTC)' : `🟢 Daily DD Safe (Buffer: ${fmtDollarPlain(s.dailyBufferDollars)})`;

    const overallBadgeColor = s.isAccountBreached ? 'var(--red-text)' : 'var(--green-text)';
    const overallBadgeText = s.isAccountBreached ? '🔴 Account Breached (Max 8% DD)' : `🟢 Overall DD Safe (Buffer: ${fmtDollarPlain(s.overallBufferDollars)})`;

    portfolioBadgesEl.innerHTML = `
      <div style="font-size:11px;padding:4px 10px;border-radius:var(--radius-sm);background:var(--surf2);border:1px solid var(--border);color:${dailyBadgeColor};font-weight:600;">
        ${dailyBadgeText}
      </div>
      <div style="font-size:11px;padding:4px 10px;border-radius:var(--radius-sm);background:var(--surf2);border:1px solid var(--border);color:${overallBadgeColor};font-weight:600;">
        ${overallBadgeText}
      </div>
      <div style="font-size:11px;padding:4px 10px;border-radius:var(--radius-sm);background:var(--surf2);border:1px solid var(--border);color:var(--gold-text);font-weight:600;">
        ⚡ Plan C Execution
      </div>
      <div style="font-size:11px;padding:4px 10px;border-radius:var(--radius-sm);background:var(--surf2);border:1px solid var(--border);color:var(--text2);">
        Fee: 0.11% Taker RT
      </div>`;

    // 2. Summary Strip
    portfolioSummaryEl.innerHTML =
      tile('Starting Funds', fmtDollarPlain(s.startingCapital)) +
      tile('Account Equity', fmtDollarPlain(s.currentEquity), rColor(s.netProfit)) +
      tile('Net Profit', `${fmtDollar(s.netProfit)} (${fmtPercent(s.netRoiPct)})`, rColor(s.netProfit)) +
      tile("Today's P&L (UTC)", `${fmtDollar(s.todayNetPnl)} (${fmtPercent(s.todayNetPct)})`, rColor(s.todayNetPnl)) +
      tile('Daily DD Limit', `${s.maxDailyDdEncounteredPct.toFixed(2)}% / ${s.dailyLimitPct}%`, s.isDailyHalted ? 'var(--red-text)' : 'var(--text)') +
      tile('Max Overall DD', `${s.maxOverallDdEncounteredPct.toFixed(2)}% / ${s.overallLimitPct}%`, s.isAccountBreached ? 'var(--red-text)' : 'var(--text)') +
      tile('Win Rate · C', s.totalTrades ? `${s.winRatePct.toFixed(1)}% (${s.wins}W / ${s.losses}L)` : '--', s.winRatePct >= 50 ? 'var(--green-text)' : 'var(--red-text)') +
      tile('Profit Factor', s.totalTrades ? s.profitFactor.toFixed(2) : '--', s.profitFactor >= 1.5 ? 'var(--green-text)' : (s.profitFactor >= 1.0 ? 'var(--gold-text)' : 'var(--red-text)')) +
      tile('Total Fees Paid', fmtDollarPlain(s.totalFeesPaid), 'var(--text2)') +
      tile('Active Positions', `${s.activeTradesCount} / ${s.maxSlots} Slots in use`, s.activeTradesCount > 0 ? 'var(--gold-text)' : 'var(--text3)');

    // 3. Active Positions Table
    const activeHtml = sim.activePositions.length === 0
      ? `<div style="background:var(--surf);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 18px;color:var(--text2);font-size:13px;">
          No open positions in portfolio right now. Active slots (${s.maxSlots}) are free for incoming qualifying signals.
         </div>`
      : `<div style="overflow-x:auto;background:var(--surf);border:1px solid var(--border);border-radius:var(--radius-lg);padding:10px 14px;">
          <table class="flows-table">
            <thead><tr>
              <th>Coin</th><th>Side</th><th>Score</th><th>Entry</th><th>Mark Price</th>
              <th>Initial SL</th><th>Dynamic Trail SL</th><th>Trailing Status</th>
              <th>Notional / Margin</th><th>Unrealized P&L</th><th>Duration</th>
            </tr></thead>
            <tbody>
              ${sim.activePositions.map(p => `
                <tr>
                  <td><strong>${esc(p.symbol.replace(/USDT$/, ''))}</strong> <span style="font-size:11px;color:var(--text3);">${esc(p.market)}</span></td>
                  <td style="color:${p.direction === 1 ? 'var(--green-text)' : 'var(--red-text)'};font-weight:600;">${p.direction === 1 ? 'Long' : 'Short'}</td>
                  <td class="mono">${esc(p.score)}</td>
                  <td class="mono">${fmtPrice(p.entry)}</td>
                  <td class="mono" style="font-weight:600;">${fmtPrice(p.markPrice)}</td>
                  <td class="mono" style="color:var(--red-text);">${fmtPrice(p.stop)}</td>
                  <td class="mono" style="color:var(--gold-text);font-weight:600;">${fmtPrice(p.currentTrailingStop)}</td>
                  <td><span style="font-size:11px;padding:3px 8px;border-radius:var(--radius-sm);background:var(--surf2);color:var(--gold-text);border:1px solid var(--border);">${esc(p.trailingStatus)}</span></td>
                  <td class="mono" style="font-size:11px;color:var(--text2);">${fmtDollarPlain(p.notional)} / ${fmtDollarPlain(p.margin)}</td>
                  <td class="mono" style="color:${rColor(p.unrealizedNetPnl)};font-weight:600;">${fmtDollar(p.unrealizedNetPnl)} (${fmtR(p.unrealizedR)})</td>
                  <td class="mono" style="font-size:11px;color:var(--text2);">${fmtDuration(p.duration_min)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
         </div>`;

    portfolioActiveEl.innerHTML = `
      <div style="font-family:var(--font-display);font-size:14px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        <span>Active Portfolio Positions (${sim.activePositions.length} / ${s.maxSlots})</span>
        <span style="font-size:11px;color:var(--text3);font-weight:normal;">Live Bybit Mark & Dynamic Trailing Stop</span>
      </div>
      ${activeHtml}`;

    // 4. Daily Breakdown Ledger (Midnight UTC Resets)
    const dailyHtml = sim.dailyLedger.length === 0
      ? `<div class="empty-state">No daily records yet.</div>`
      : `<div style="overflow-x:auto;background:var(--surf);border:1px solid var(--border);border-radius:var(--radius-lg);padding:10px 14px;">
          <table class="flows-table">
            <thead><tr>
              <th>Date (UTC)</th><th>Starting Equity</th><th>Trades</th><th>W / L</th><th>Gross P&L</th>
              <th>Bybit Fees</th><th>Net P&L ($)</th><th>Daily ROI</th><th>Max Daily DD</th><th>Daily Status</th>
            </tr></thead>
            <tbody>
              ${sim.dailyLedger.map(d => {
                const dayRoi = d.startCapital ? (d.netPnl / d.startCapital) * 100 : 0;
                const statusHtml = d.isHalted
                  ? '<span style="color:var(--red-text);font-weight:600;">🔴 Limit Hit (Halted)</span>'
                  : (d.date === s.currentUtcDay
                    ? '<span style="color:var(--green-text);font-weight:600;">🟢 Active (Today)</span>'
                    : '<span style="color:var(--text2);">⚪ Completed</span>');
                return `
                <tr>
                  <td><strong>${esc(d.date)}</strong> ${d.date === s.currentUtcDay ? '<span style="font-size:10px;color:var(--gold-text);">(Midnight UTC Reset Active)</span>' : ''}</td>
                  <td class="mono">${fmtDollarPlain(d.startCapital)}</td>
                  <td class="mono">${d.tradesCount}</td>
                  <td class="mono" style="font-size:11px;">${d.wins}W / ${d.losses}L</td>
                  <td class="mono" style="color:${rColor(d.grossPnl)};">${fmtDollar(d.grossPnl)}</td>
                  <td class="mono" style="font-size:11px;color:var(--text3);">${fmtDollarPlain(d.fees)}</td>
                  <td class="mono" style="color:${rColor(d.netPnl)};font-weight:600;">${fmtDollar(d.netPnl)}</td>
                  <td class="mono" style="color:${rColor(dayRoi)};">${fmtPercent(dayRoi)}</td>
                  <td class="mono" style="color:${d.maxDailyDd >= 0.04 ? 'var(--red-text)' : 'var(--text2)'};">${(d.maxDailyDd * 100).toFixed(2)}%</td>
                  <td>${statusHtml}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
         </div>`;

    portfolioDailyEl.innerHTML = `
      <div style="font-family:var(--font-display);font-size:14px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        <span>Daily Performance Ledger</span>
        <span style="font-size:11px;color:var(--text3);font-weight:normal;">Strict 00:00:00 UTC Midnight Reset & 4% Daily Drawdown Circuit Breaker</span>
      </div>
      ${dailyHtml}`;

    // 5. Closed Trades History Ledger (Plan C)
    const closedHtml = sim.closedTrades.length === 0
      ? `<div class="empty-state">No closed portfolio trades matching current filter parameters yet.</div>`
      : `<div style="overflow-x:auto;background:var(--surf);border:1px solid var(--border);border-radius:var(--radius-lg);padding:10px 14px;">
          <table class="flows-table">
            <thead><tr>
              <th>Time (UTC)</th><th>Coin</th><th>Side</th><th>Score</th><th>Trigger</th>
              <th>Entry</th><th>Exit</th><th>Duration</th><th>Plan C R</th>
              <th>Gross P&L</th><th>Bybit Fee</th><th>Net P&L ($)</th><th>Exit Reason</th><th>Account Balance</th>
            </tr></thead>
            <tbody>
              ${sim.closedTrades.map(t => `
                <tr>
                  <td style="font-size:11px;color:var(--text3);white-space:nowrap;">${esc(new Date(t.exitTime || t.bar_time).toLocaleString())}</td>
                  <td><strong>${esc(t.symbol.replace(/USDT$/, ''))}</strong> <span style="font-size:11px;color:var(--text3);">${esc(t.market)}</span></td>
                  <td style="color:${t.direction === 1 ? 'var(--green-text)' : 'var(--red-text)'};font-weight:600;">${t.direction === 1 ? 'Long' : 'Short'}</td>
                  <td class="mono">${esc(t.score)}</td>
                  <td style="font-size:11px;color:var(--text2);">${esc(t.trigger_name || '--')}</td>
                  <td class="mono">${fmtPrice(t.entry)}</td>
                  <td class="mono">${fmtPrice(t.target && t.stop ? (t.direction === 1 ? t.entry + t.outcome_c * Math.abs(t.entry - t.stop) : t.entry - t.outcome_c * Math.abs(t.entry - t.stop)) : '--')}</td>
                  <td class="mono" style="font-size:11px;color:var(--text2);">${fmtDuration(t.duration_min)}</td>
                  <td class="mono" style="color:${rColor(t.outcome_c)};font-weight:600;">${fmtR(t.outcome_c)}</td>
                  <td class="mono" style="color:${rColor(t.grossPnl)};">${fmtDollar(t.grossPnl)}</td>
                  <td class="mono" style="font-size:11px;color:var(--text3);">${fmtDollarPlain(t.fee)}</td>
                  <td class="mono" style="color:${rColor(t.netPnl)};font-weight:600;">${fmtDollar(t.netPnl)}</td>
                  <td><span style="font-size:11px;text-transform:capitalize;color:var(--text2);">${esc(t.exit_reason || 'resolved')}</span></td>
                  <td class="mono" style="font-weight:600;">${fmtDollarPlain(t.balanceAfter)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
         </div>`;

    portfolioClosedEl.innerHTML = `
      <div style="font-family:var(--font-display);font-size:14px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
        <span>Portfolio Closed Trades History</span>
        <span style="font-size:11px;color:var(--text3);font-weight:normal;">Realized Plan C Execution (Dynamic Trailing Stop + Tighter Horizon)</span>
      </div>
      ${closedHtml}`;
  }

  // -------------------------------------------------------------------------
  // Bybit Mark Prices Fetching
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Data Loader
  // -------------------------------------------------------------------------
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

      if (state.mode === 'portfolio') {
        renderPortfolio();
      } else {
        renderTabs();
        renderSummary(statsFiltered());
        renderList(filtered(), state.marks);
      }
    } catch (e) {
      summaryEl.innerHTML = '';
      listEl.innerHTML = `<div class="empty-state">Could not load the journal (${esc(e.message)}).</div>`;
      portfolioSummaryEl.innerHTML = `<div class="empty-state">Could not load portfolio (${esc(e.message)}).</div>`;
    }
  }

  setMode(state.mode);
  load();
  setInterval(load, 60000);
})();

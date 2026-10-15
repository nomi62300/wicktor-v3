/* ==========================================================================
   Wicktor — Signal Journal & Prop Firm Portfolio Page

   Dual-mode dashboard:
   1. Raw Signal Journal: Complete historical record of all signals generated,
      displaying Plan A, B, and C exit metrics.
   2. $10,000 Prop Firm Portfolio: Full prop-firm dashboard matching institutional
      trading evaluation standards:
      - 4 Sub-Tabs: Account Overview, Trading Overview, Trading History, Calendar
      - Daily 4% Drawdown with Live Midnight (00:00:00 UTC) Countdown Timer
      - Max 8% Overall Drawdown ($9,200 hard floor)
      - Evaluation Profit Target ($10,800 / 8%)
      - Execution strictly under Plan C with Bybit 0.11% Taker Fees
   ========================================================================== */

(() => {
  const REST = 'https://laqytygibnlpdohouxaq.supabase.co/rest/v1/signal_journal';
  const KEY = 'sb_publishable_UVTLR2Ug_GjpHTEMXIeaJw_IJ1iI3xS';
  const LIST_LIMIT = 500;
  const BYBIT = 'https://api.bybit.com';
  const TP_TRACKING_SINCE = Date.parse('2026-08-26T09:00:00Z');

  // DOM Elements - Mode Switch
  const journalViewEl = document.getElementById('journal-view');
  const portfolioViewEl = document.getElementById('portfolio-view');
  const modeJournalBtn = document.getElementById('mode-journal-btn');
  const modePortfolioBtn = document.getElementById('mode-portfolio-btn');

  // DOM Elements - Raw Journal
  const summaryEl = document.getElementById('summary');
  const listEl = document.getElementById('list');
  const tableNoteEl = document.getElementById('table-note');
  const tabsEl = document.getElementById('tabs');

  // DOM Elements - Prop Portfolio Subtabs & Panels
  const propStatusBadgeEl = document.getElementById('prop-account-status-badge');
  const propSubtabBtns = document.querySelectorAll('.prop-subtab-btn[data-subtab]');
  const propPanels = document.querySelectorAll('.prop-subtab-panel');
  const propSettingsToggleBtn = document.getElementById('prop-settings-toggle');
  const propSettingsPanel = document.getElementById('prop-settings-panel');

  // Subtab 1 Elements
  const propObjectivesGrid = document.getElementById('prop-objectives-grid');
  const propStatsCards = document.getElementById('prop-stats-cards');
  const propChartContainer = document.getElementById('prop-chart-container');
  const propPnlCard = document.getElementById('prop-pnl-card');
  const propAccountInfoCard = document.getElementById('prop-account-info-card');
  const propTradingSummaryGrid = document.getElementById('prop-trading-summary-grid');

  // Subtab 2 Elements
  const propOverviewKpis = document.getElementById('prop-overview-kpis');
  const propWeekdayChart = document.getElementById('prop-weekday-chart');
  const propSessionsGrid = document.getElementById('prop-sessions-grid');
  const propCumulativeChart = document.getElementById('prop-cumulative-chart');
  const propDetailedStatsGrid = document.getElementById('prop-detailed-stats-grid');
  const propDailyBarsChart = document.getElementById('prop-daily-bars-chart');
  const propLongshortCard = document.getElementById('prop-longshort-card');
  const propRecentSnippetCard = document.getElementById('prop-recent-snippet-card');

  // Subtab 3 Elements
  const propHistoryTbody = document.getElementById('prop-history-tbody');
  const propHistorySearch = document.getElementById('prop-history-search');
  const propHistoryCountBadge = document.getElementById('prop-history-count-badge');
  const propHistoryPagination = document.getElementById('prop-history-pagination');

  // Subtab 4 Elements
  const propCalTopCards = document.getElementById('prop-cal-top-cards');
  const propCalStreaksCards = document.getElementById('prop-cal-streaks-cards');
  const propCalendarGrid = document.getElementById('prop-calendar-grid');
  const propCalDonutWrap = document.getElementById('prop-cal-donut-wrap');
  const propCalSidebarStats = document.getElementById('prop-cal-sidebar-stats');
  const propCalUnitToggle = document.getElementById('prop-cal-unit-toggle');

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
    themeBtn.innerHTML = t === 'light' ? ICON_SUN : ICON_MOON;
  }
  applyTheme(localStorage.getItem('wicktor:theme') || 'dark');
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem('wicktor:theme', next);
    applyTheme(next);
  });

  // Formatters
  const fmtR = v => v == null ? '--' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2) + 'R';
  const fmtPct = v => v == null ? '--' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(0) + '%';
  const fmtPct2 = v => v == null ? '--' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  const fmtDollar = v => v == null ? '--' : (Number(v) >= 0 ? '+$' : '-$') + Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const initialMode = (window.location.hash.startsWith('#portfolio') || window.location.search.includes('tab=portfolio'))
    ? 'portfolio'
    : (localStorage.getItem('wicktor:journal_mode') || 'journal');

  const state = {
    mode: initialMode,
    subtab: 'account-overview',
    calendarUnit: 'dollar',
    historySearch: '',
    historyPage: 1,
    historyPerPage: 10,
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

  // Live Midnight UTC Countdown Timer
  function updateCountdown() {
    const now = Date.now();
    const msInDay = 86400000;
    const msRemaining = msInDay - (now % msInDay);
    const secs = Math.floor((msRemaining / 1000) % 60);
    const mins = Math.floor((msRemaining / (1000 * 60)) % 60);
    const hours = Math.floor((msRemaining / (1000 * 60 * 60)) % 24);
    const days = Math.floor(msRemaining / msInDay);

    const dEl = document.getElementById('cd-days');
    const hEl = document.getElementById('cd-hours');
    const mEl = document.getElementById('cd-mins');
    const sEl = document.getElementById('cd-secs');

    if (dEl) dEl.textContent = days;
    if (hEl) hEl.textContent = String(hours).padStart(2, '0');
    if (mEl) mEl.textContent = String(mins).padStart(2, '0');
    if (sEl) sEl.textContent = String(secs).padStart(2, '0');
  }
  setInterval(updateCountdown, 1000);
  updateCountdown();

  // Mode Switching (Raw Journal vs Prop Portfolio)
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

  // Prop Subtabs Switching
  function setSubtab(subtabId) {
    state.subtab = subtabId;
    propSubtabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === subtabId);
    });
    propPanels.forEach(panel => {
      panel.style.display = panel.id === `subtab-${subtabId}` ? 'block' : 'none';
    });
    renderPortfolio();
  }

  propSubtabBtns.forEach(btn => {
    btn.addEventListener('click', () => setSubtab(btn.dataset.subtab));
  });

  if (propSettingsToggleBtn) {
    propSettingsToggleBtn.addEventListener('click', () => {
      const isHidden = propSettingsPanel.style.display === 'none';
      propSettingsPanel.style.display = isHidden ? 'block' : 'none';
      propSettingsToggleBtn.classList.toggle('active', isHidden);
    });
  }

  // Parameter Controls
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

    if (propCalUnitToggle) {
      propCalUnitToggle.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          propCalUnitToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.calendarUnit = btn.dataset.unit;
          renderPortfolioCalendar(state.currentSim);
        });
      });
    }

    if (propHistorySearch) {
      propHistorySearch.addEventListener('input', e => {
        state.historySearch = e.target.value.trim().toUpperCase();
        state.historyPage = 1;
        renderPortfolioHistory(state.currentSim);
      });
    }
  }
  setupPortfolioControls();

  // -------------------------------------------------------------------------
  // RAW SIGNAL JOURNAL RENDERING
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
  // PROP FIRM DASHBOARD RENDERING (4 SUB-TABS)
  // -------------------------------------------------------------------------
  function renderPortfolio() {
    if (!window.PortfolioSimulator) return;

    const sim = window.PortfolioSimulator.simulate(state.statsRows, {
      ...state.portfolioOpts,
      liveMarks: state.marks
    });
    state.currentSim = sim;

    const s = sim.summary;

    // Header badge
    if (propStatusBadgeEl) {
      if (s.isAccountBreached) {
        propStatusBadgeEl.className = 'prop-badge-halted';
        propStatusBadgeEl.textContent = 'Breached (8% DD)';
      } else if (s.isDailyHalted) {
        propStatusBadgeEl.className = 'prop-badge-halted';
        propStatusBadgeEl.textContent = 'Halted (4% Daily Limit)';
      } else {
        propStatusBadgeEl.className = 'prop-badge-active';
        propStatusBadgeEl.textContent = 'Active (Phase 1)';
      }
    }

    if (state.subtab === 'account-overview') renderPortfolioAccountOverview(sim);
    else if (state.subtab === 'trading-overview') renderPortfolioTradingOverview(sim);
    else if (state.subtab === 'trading-history') renderPortfolioHistory(sim);
    else if (state.subtab === 'calendar') renderPortfolioCalendar(sim);
  }

  // Sub-Tab 1: Account Overview
  function renderPortfolioAccountOverview(sim) {
    const o = sim.objectives;
    const s = sim.summary;
    const st = sim.stats;

    // 1. Objectives Grid
    propObjectivesGrid.innerHTML = `
      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);font-weight:500;">Daily Drawdown Level</span>
          <span style="font-size:11px;font-family:var(--font-mono);background:var(--surf2);padding:2px 6px;border-radius:4px;color:var(--text3);">${fmtDollarPlain(o.dailyDdLevel)}</span>
        </div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:10px 0 4px;color:var(--text);">
          ${fmtDollarPlain(o.dailyDdLeft)} <span style="font-size:13px;color:var(--text3);font-weight:normal;">left</span>
        </div>
        <div class="prop-progress-track">
          <div class="prop-progress-fill-coral" style="width:${Math.max(2, o.dailyUsedPct)}%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px;">
          <span>${o.dailyUsedPct.toFixed(1)}% used</span>
          <span>100% max ($400)</span>
        </div>
      </div>

      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);font-weight:500;">Max Drawdown Level</span>
          <span style="font-size:11px;font-family:var(--font-mono);background:var(--surf2);padding:2px 6px;border-radius:4px;color:var(--text3);">${fmtDollarPlain(o.maxDdLevel)}</span>
        </div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:10px 0 4px;color:var(--text);">
          ${fmtDollarPlain(o.maxDdLeft)} <span style="font-size:13px;color:var(--text3);font-weight:normal;">left</span>
        </div>
        <div class="prop-progress-track">
          <div class="prop-progress-fill-coral" style="width:${Math.max(2, o.maxUsedPct)}%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px;">
          <span>${o.maxUsedPct.toFixed(1)}% used</span>
          <span>100% max ($800)</span>
        </div>
      </div>

      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);font-weight:500;">Target Profit</span>
          <span style="font-size:11px;font-family:var(--font-mono);background:var(--surf2);padding:2px 6px;border-radius:4px;color:var(--text3);">${fmtDollarPlain(o.targetProfitLevel)}</span>
        </div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:10px 0 4px;color:var(--green-text);">
          ${fmtDollarPlain(o.targetProfitLeft)} <span style="font-size:13px;color:var(--text3);font-weight:normal;">left</span>
        </div>
        <div class="prop-progress-track">
          <div class="prop-progress-fill-emerald" style="width:${Math.max(2, o.targetProgressPct)}%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px;">
          <span>${o.targetProgressPct.toFixed(1)}% reached</span>
          <span>100% goal ($800)</span>
        </div>
      </div>`;

    // 2. Stats Cards
    propStatsCards.innerHTML = `
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Trading Days</div>
        <div style="font-size:24px;font-family:var(--font-mono);font-weight:700;margin-top:6px;">${st.tradingDaysCount} / ${st.minTradingDays}</div>
      </div>
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Most Traded Asset</div>
        <div style="font-size:20px;font-family:var(--font-mono);font-weight:700;margin-top:8px;">${st.mostTradedAsset}</div>
      </div>
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Avg Winning Trade</div>
        <div style="font-size:24px;font-family:var(--font-mono);font-weight:700;margin-top:6px;color:var(--green-text);">${fmtDollar(st.avgWin)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">${fmtR(st.avgRWin)} avg R</div>
      </div>
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Avg Losing Trade</div>
        <div style="font-size:24px;font-family:var(--font-mono);font-weight:700;margin-top:6px;color:var(--red-text);">${fmtDollar(st.avgLoss)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">-${fmtR(st.avgRLoss)} avg R</div>
      </div>`;

    // 3. SVG Balance Chart
    renderBalanceCurveChart(sim.curvePoints, sim.summary.startingCapital);

    // 4. Details Cards
    propPnlCard.innerHTML = `
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Profit / Loss</div>
      <div style="font-size:28px;font-family:var(--font-mono);font-weight:700;margin:6px 0 10px;color:${rColor(s.netProfit)};">
        ${fmtDollar(s.netProfit)}
      </div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:10px;margin-top:6px;">
        <span style="font-size:12px;color:var(--text2);">Profit Split</span>
        <span style="font-size:13px;font-weight:600;color:var(--text);">${st.profitSplit}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;">
        <span style="font-size:12px;color:var(--text2);">Account</span>
        <span style="font-size:13px;font-weight:600;color:var(--gold-text);">${st.accountPhase}</span>
      </div>`;

    propAccountInfoCard.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);">Equity</span>
          <span style="font-size:15px;font-family:var(--font-mono);font-weight:700;color:${rColor(s.netProfit)};">${fmtDollarPlain(s.currentEquity)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);">Balance</span>
          <span style="font-size:15px;font-family:var(--font-mono);font-weight:700;">${fmtDollarPlain(s.currentBalance)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);">Start Date</span>
          <span style="font-size:12px;font-family:var(--font-mono);">Oct 14, 2026</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);">Account Size</span>
          <span style="font-size:13px;font-family:var(--font-mono);font-weight:600;">${fmtDollarPlain(s.startingCapital)}</span>
        </div>
      </div>`;

    // 5. Trading Summary (Win Rate & Profit Factor)
    const winRatio = s.totalTrades ? (s.wins / s.totalTrades) * 100 : 50;
    const lossRatio = 100 - winRatio;

    propTradingSummaryGrid.innerHTML = `
      <div class="prop-card">
        <div style="display:flex;align-items:center;gap:8px;">
          <span>🏆</span>
          <span style="font-size:12px;color:var(--text2);font-weight:500;">Trade Win Rate</span>
        </div>
        <div style="font-size:28px;font-family:var(--font-mono);font-weight:700;margin:8px 0 4px;color:var(--text);">
          ${s.winRatePct.toFixed(2)}%
        </div>
        <div class="prop-progress-dual">
          <div class="prop-dual-win" style="width:${winRatio}%;"></div>
          <div class="prop-dual-loss" style="width:${lossRatio}%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-top:6px;">
          <span style="color:var(--green-text);">${s.wins} Wins</span>
          <span style="color:var(--red-text);">${s.losses} Losses</span>
        </div>
      </div>

      <div class="prop-card">
        <div style="display:flex;align-items:center;gap:8px;">
          <span>⚖️</span>
          <span style="font-size:12px;color:var(--text2);font-weight:500;">Profit Factor</span>
        </div>
        <div style="font-size:28px;font-family:var(--font-mono);font-weight:700;margin:8px 0 4px;color:var(--text);">
          ${s.profitFactor.toFixed(2)}
        </div>
        <div class="prop-progress-dual">
          <div class="prop-dual-win" style="width:${Math.min(100, Math.max(10, (s.profitFactor / (s.profitFactor + 1)) * 100))}%;"></div>
          <div class="prop-dual-loss" style="width:${Math.max(10, (1 / (s.profitFactor + 1)) * 100)}%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-top:6px;">
          <span>Wins / Losses</span>
          <span style="color:${s.profitFactor >= 1.5 ? 'var(--green-text)' : 'var(--gold-text)'};">Target &gt; 1.50</span>
        </div>
      </div>`;
  }

  // Balance Chart SVG Renderer
  function renderBalanceCurveChart(points, startingCapital) {
    if (!propChartContainer) return;
    if (!points || points.length < 2) {
      propChartContainer.innerHTML = '<div class="empty-state">Not enough data points for balance curve yet.</div>';
      return;
    }

    const W = propChartContainer.clientWidth || 550;
    const H = 200;
    const padX = 40;
    const padY = 25;

    const values = points.map(p => p.balance);
    const minVal = Math.min(8800, ...values);
    const maxVal = Math.max(11000, ...values);
    const range = maxVal - minVal || 1;

    const scaleX = i => padX + (i / (points.length - 1)) * (W - padX * 2);
    const scaleY = v => H - padY - ((v - minVal) / range) * (H - padY * 2);

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i).toFixed(1)} ${scaleY(p.balance).toFixed(1)}`).join(' ');

    const targetY = scaleY(10800);
    const maxDdY = scaleY(9200);
    const startY = scaleY(startingCapital);

    propChartContainer.innerHTML = `
      <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible;">
        <!-- Grid lines -->
        <line x1="${padX}" y1="${targetY}" x2="${W - padX}" y2="${targetY}" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.65" />
        <text x="${padX - 8}" y="${targetY + 4}" fill="#10b981" font-size="9" text-anchor="end" font-family="var(--font-mono)">$10.8k</text>

        <line x1="${padX}" y1="${startY}" x2="${W - padX}" y2="${startY}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
        <text x="${padX - 8}" y="${startY + 4}" fill="var(--text3)" font-size="9" text-anchor="end" font-family="var(--font-mono)">$10k</text>

        <line x1="${padX}" y1="${maxDdY}" x2="${W - padX}" y2="${maxDdY}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,4" opacity="0.65" />
        <text x="${padX - 8}" y="${maxDdY + 4}" fill="#f59e0b" font-size="9" text-anchor="end" font-family="var(--font-mono)">$9.2k</text>

        <!-- Balance Curve -->
        <path d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${points.map((p, i) => `<circle cx="${scaleX(i).toFixed(1)}" cy="${scaleY(p.balance).toFixed(1)}" r="3" fill="#38bdf8" />`).join('')}
      </svg>`;
  }

  // Sub-Tab 2: Trading Overview
  function renderPortfolioTradingOverview(sim) {
    const s = sim.summary;
    const st = sim.stats;

    // Row 1: KPI Cards
    propOverviewKpis.innerHTML = `
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Net P&L</div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:6px 0;color:${rColor(s.netProfit)};">
          ${fmtDollar(s.netProfit)}
        </div>
        <div style="font-size:11px;color:${rColor(s.netRoiPct)};">${fmtPercent(s.netRoiPct)} total ROI</div>
      </div>
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Average Realized R:R</div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:6px 0;color:var(--text);">
          ${st.avgRealizedRr.toFixed(2)}
        </div>
        <div style="font-size:11px;color:var(--text2);">Plan C trailing target</div>
      </div>
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Win Rate</div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:6px 0;color:${s.winRatePct >= 50 ? 'var(--green-text)' : 'var(--red-text)'};">
          ${s.winRatePct.toFixed(2)}%
        </div>
        <div style="display:flex;gap:6px;font-size:10px;margin-top:4px;">
          <span style="background:rgba(16,185,129,0.15);color:var(--green-text);padding:2px 6px;border-radius:4px;">${s.wins} W</span>
          <span style="background:rgba(239,68,68,0.15);color:var(--red-text);padding:2px 6px;border-radius:4px;">${s.losses} L</span>
        </div>
      </div>
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Profit Factor</div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:6px 0;color:${s.profitFactor >= 1.5 ? 'var(--green-text)' : 'var(--text)'};">
          ${s.profitFactor.toFixed(2)}
        </div>
        <div style="font-size:11px;color:var(--text3);">${fmtDollarPlain(st.totalVolumeUsdt)} volume</div>
      </div>`;

    // Row 2: Weekday Bar Chart
    const maxDayTrades = Math.max(1, ...sim.weekdayDistribution.map(w => w.trades));
    propWeekdayChart.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;height:140px;gap:8px;padding-top:10px;">
        ${sim.weekdayDistribution.map(w => {
          const hWin = (w.wins / maxDayTrades) * 100;
          const hLoss = (w.losses / maxDayTrades) * 100;
          return `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;">
            <div style="display:flex;gap:3px;align-items:flex-end;width:100%;justify-content:center;height:100px;">
              <div style="width:10px;background:#10b981;height:${Math.max(4, hWin)}%;border-radius:2px 2px 0 0;" title="${w.day}: ${w.wins} wins"></div>
              <div style="width:10px;background:#ef4444;height:${Math.max(4, hLoss)}%;border-radius:2px 2px 0 0;" title="${w.day}: ${w.losses} losses"></div>
            </div>
            <div style="font-size:11px;color:var(--text2);margin-top:6px;font-weight:600;">${w.day}</div>
            <div style="font-size:9px;color:var(--text3);">${w.trades} t</div>
          </div>`;
        }).join('')}
      </div>`;

    // Row 2: Sessions Grid
    propSessionsGrid.innerHTML = Object.entries(sim.sessions).map(([k, sess]) => `
      <div style="background:var(--surf2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;font-weight:600;color:var(--text);">${esc(sess.name)}</span>
          <span style="font-size:12px;font-family:var(--font-mono);font-weight:600;color:${rColor(sess.netPnl)};">${fmtPercent(sess.pnlPct)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:6px;">
          <span>${sess.trades} Trades</span>
          <span>WR: ${sess.winRatePct.toFixed(0)}%</span>
        </div>
      </div>`).join('');

    // Row 3: Daily Cumulative PnL Chart
    renderCumulativePnlChart(sim.curvePoints);

    // Row 4: Detailed Statistics Grid
    propDetailedStatsGrid.innerHTML = `
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-bottom:8px;">P&L Statistics</div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Avg Daily P&L</span><span class="mono" style="color:${rColor(st.avgDailyPnl)};">${fmtDollar(st.avgDailyPnl)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Avg Trade P&L</span><span class="mono" style="color:${rColor(st.avgTradePnl)};">${fmtDollar(st.avgTradePnl)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Avg Winning Trade</span><span class="mono" style="color:var(--green-text);">${fmtDollar(st.avgWin)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Avg Losing Trade</span><span class="mono" style="color:var(--red-text);">${fmtDollar(st.avgLoss)}</span></div>
        </div>
      </div>

      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-bottom:8px;">Trading Activity</div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Total Trades</span><span class="mono">${s.totalTrades}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Winning Trades</span><span class="mono" style="color:var(--green-text);">${s.wins}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Losing Trades</span><span class="mono" style="color:var(--red-text);">${s.losses}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Active Slots</span><span class="mono" style="color:var(--gold-text);">${s.activeTradesCount} / ${s.maxSlots}</span></div>
        </div>
      </div>

      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-bottom:8px;">Streaks & Patterns</div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Max Win Streak</span><span class="mono" style="color:var(--green-text);">${st.maxWinStreak} trades</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Max Loss Streak</span><span class="mono" style="color:var(--red-text);">${st.maxLossStreak} trades</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Max Winning Days</span><span class="mono">${st.maxWinDays} days</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Max Losing Days</span><span class="mono">${st.maxLossDays} days</span></div>
        </div>
      </div>

      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-bottom:8px;">Costs & Fees</div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Bybit Taker Fees</span><span class="mono">${fmtDollarPlain(s.totalFeesPaid)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Avg Fee / Trade</span><span class="mono">${fmtDollarPlain(s.totalTrades ? s.totalFeesPaid / s.totalTrades : 0)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Funding / Swap</span><span class="mono">$0.00</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Fee Rate</span><span class="mono">0.11% RT</span></div>
        </div>
      </div>`;

    // Row 5: Daily Net P&L Bars Chart
    renderDailyBarsChart(sim.dailyLedger);

    // Row 6: Long / Short Card
    const ls = sim.longShortStats;
    propLongshortCard.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:12px;">Long / Short Performance</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="background:var(--surf2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;">
          <div style="font-size:12px;font-weight:600;color:var(--green-text);">Long Positions (${ls.longsCount})</div>
          <div style="font-size:18px;font-family:var(--font-mono);font-weight:700;margin:4px 0;color:${rColor(ls.longNetPnl)};">${fmtDollar(ls.longNetPnl)}</div>
          <div style="font-size:11px;color:var(--text3);">Win Rate: ${ls.longWinRate.toFixed(1)}% (${ls.longWins}W / ${ls.longLosses}L)</div>
        </div>
        <div style="background:var(--surf2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;">
          <div style="font-size:12px;font-weight:600;color:var(--red-text);">Short Positions (${ls.shortsCount})</div>
          <div style="font-size:18px;font-family:var(--font-mono);font-weight:700;margin:4px 0;color:${rColor(ls.shortNetPnl)};">${fmtDollar(ls.shortNetPnl)}</div>
          <div style="font-size:11px;color:var(--text3);">Win Rate: ${ls.shortWinRate.toFixed(1)}% (${ls.shortWins}W / ${ls.shortLosses}L)</div>
        </div>
      </div>`;

    propRecentSnippetCard.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span style="font-size:13px;font-weight:600;">Active Portfolio Slots (${sim.activePositions.length} / ${s.maxSlots})</span>
        <span style="font-size:11px;color:var(--gold-text);">${s.maxSlots - sim.activePositions.length} free</span>
      </div>
      ${sim.activePositions.length === 0
        ? '<div style="color:var(--text3);font-size:12px;">No active open positions. Awaiting next qualifying setup.</div>'
        : `<div style="display:flex;flex-direction:column;gap:6px;">
            ${sim.activePositions.slice(0, 3).map(p => `
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surf2);padding:8px 12px;border-radius:var(--radius-sm);">
                <div><strong>${esc(p.symbol.replace(/USDT$/, ''))}</strong> <span style="color:${p.direction === 1 ? 'var(--green-text)' : 'var(--red-text)'};">${p.direction === 1 ? 'Long' : 'Short'}</span></div>
                <div class="mono" style="color:${rColor(p.unrealizedNetPnl)};font-weight:600;">${fmtDollar(p.unrealizedNetPnl)} (${fmtR(p.unrealizedR)})</div>
              </div>`).join('')}
          </div>`}`;
  }

  function renderCumulativePnlChart(points) {
    if (!propCumulativeChart) return;
    if (!points || points.length < 2) {
      propCumulativeChart.innerHTML = '<div class="empty-state">No cumulative trade points yet.</div>';
      return;
    }

    const W = propCumulativeChart.clientWidth || 700;
    const H = 160;
    const padX = 40;
    const padY = 20;

    const values = points.map(p => p.netPnl);
    const minVal = Math.min(0, ...values);
    const maxVal = Math.max(0, ...values) || 1;
    const range = maxVal - minVal || 1;

    const scaleX = i => padX + (i / (points.length - 1)) * (W - padX * 2);
    const scaleY = v => H - padY - ((v - minVal) / range) * (H - padY * 2);

    const zeroY = scaleY(0);
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i).toFixed(1)} ${scaleY(p.netPnl).toFixed(1)}`).join(' ');
    const areaD = `${pathD} L ${scaleX(points.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${scaleX(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;

    propCumulativeChart.innerHTML = `
      <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible;">
        <defs>
          <linearGradient id="cumPnlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <line x1="${padX}" y1="${zeroY}" x2="${W - padX}" y2="${zeroY}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
        <path d="${areaD}" fill="url(#cumPnlGrad)" />
        <path d="${pathD}" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" />
        ${points.map((p, i) => `<circle cx="${scaleX(i).toFixed(1)}" cy="${scaleY(p.netPnl).toFixed(1)}" r="2.5" fill="#10b981" />`).join('')}
      </svg>`;
  }

  function renderDailyBarsChart(dailyList) {
    if (!propDailyBarsChart) return;
    const days = (dailyList || []).filter(d => d.tradesCount > 0).slice().reverse();
    if (!days.length) {
      propDailyBarsChart.innerHTML = '<div class="empty-state">No daily trade data yet.</div>';
      return;
    }

    const maxAbs = Math.max(10, ...days.map(d => Math.abs(d.netPnl)));
    propDailyBarsChart.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;height:120px;gap:12px;padding:10px 0;">
        ${days.map(d => {
          const isPos = d.netPnl >= 0;
          const pctHeight = (Math.abs(d.netPnl) / maxAbs) * 50;
          return `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:center;">
            <div style="height:50px;display:flex;align-items:flex-end;">
              ${isPos ? `<div style="width:24px;background:#10b981;height:${Math.max(6, pctHeight)}px;border-radius:3px 3px 0 0;" title="${d.date}: ${fmtDollar(d.netPnl)}"></div>` : ''}
            </div>
            <div style="width:100%;height:1px;background:rgba(255,255,255,0.2);"></div>
            <div style="height:50px;display:flex;align-items:flex-start;">
              ${!isPos ? `<div style="width:24px;background:#ef4444;height:${Math.max(6, pctHeight)}px;border-radius:0 0 3px 3px;" title="${d.date}: ${fmtDollar(d.netPnl)}"></div>` : ''}
            </div>
            <div style="font-size:10px;font-family:var(--font-mono);margin-top:4px;">${d.date.slice(5)}</div>
            <div style="font-size:10px;font-weight:600;color:${rColor(d.netPnl)};">${fmtDollar(d.netPnl)}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  // Sub-Tab 3: Trading History
  function renderPortfolioHistory(sim) {
    if (!propHistoryTbody) return;

    let trades = sim.closedTrades.slice();
    if (state.historySearch) {
      trades = trades.filter(t => t.symbol.toUpperCase().includes(state.historySearch));
    }

    if (propHistoryCountBadge) {
      propHistoryCountBadge.textContent = `${trades.length} trades recorded`;
    }

    if (!trades.length) {
      propHistoryTbody.innerHTML = '<tr><td colspan="10" class="empty-state">No matching trade history found.</td></tr>';
      if (propHistoryPagination) propHistoryPagination.innerHTML = '';
      return;
    }

    const startIdx = (state.historyPage - 1) * state.historyPerPage;
    const pageTrades = trades.slice(startIdx, startIdx + state.historyPerPage);
    const totalPages = Math.ceil(trades.length / state.historyPerPage);

    propHistoryTbody.innerHTML = pageTrades.map(t => {
      const openDate = new Date(t.bar_time);
      const closeDate = new Date(t.exitTime || t.bar_time);
      const isBuy = t.direction === 1;
      const sideClass = isBuy ? 'prop-badge-buy' : 'prop-badge-sell';
      const exitPrice = t.target && t.stop ? (isBuy ? t.entry + t.outcome_c * Math.abs(t.entry - t.stop) : t.entry - t.outcome_c * Math.abs(t.entry - t.stop)) : t.entry;

      return `
        <tr>
          <td class="mono" style="font-size:11px;color:var(--text3);">#${t.id || '5044' + Math.floor(t.bar_time / 1000)}</td>
          <td style="font-size:11px;white-space:nowrap;">${openDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} &middot; ${openDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          <td class="mono">${fmtPrice(t.entry)}</td>
          <td style="font-size:11px;white-space:nowrap;">${closeDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} &middot; ${closeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          <td class="mono">${fmtPrice(exitPrice)}</td>
          <td><span class="${sideClass}">${isBuy ? 'Buy' : 'Sell'}</span></td>
          <td><strong>${esc(t.symbol.replace(/USDT$/, ''))}</strong><span style="font-size:10px;color:var(--text3);">.P</span></td>
          <td class="mono">${fmtDollarPlain(t.notional)}</td>
          <td class="mono" style="color:${rColor(t.netPnl)};font-weight:600;">${fmtDollar(t.netPnl)} <span style="font-size:11px;opacity:0.8;">(${fmtR(t.outcome_c)})</span></td>
          <td style="font-size:11px;color:var(--text2);text-transform:capitalize;">${esc(t.exit_reason || 'trail')}</td>
        </tr>`;
    }).join('');

    // Pagination
    if (propHistoryPagination) {
      propHistoryPagination.innerHTML = `
        <div>Showing ${startIdx + 1}–${Math.min(trades.length, startIdx + state.historyPerPage)} of ${trades.length}</div>
        <div style="display:flex;gap:6px;">
          <button class="chip" ${state.historyPage <= 1 ? 'disabled style="opacity:0.4;"' : ''} id="prop-hist-prev">&larr; Prev</button>
          <span style="padding:4px 8px;font-family:var(--font-mono);">${state.historyPage} / ${totalPages}</span>
          <button class="chip" ${state.historyPage >= totalPages ? 'disabled style="opacity:0.4;"' : ''} id="prop-hist-next">Next &rarr;</button>
        </div>`;

      const prevBtn = document.getElementById('prop-hist-prev');
      const nextBtn = document.getElementById('prop-hist-next');
      if (prevBtn) prevBtn.addEventListener('click', () => { if (state.historyPage > 1) { state.historyPage--; renderPortfolioHistory(sim); } });
      if (nextBtn) nextBtn.addEventListener('click', () => { if (state.historyPage < totalPages) { state.historyPage++; renderPortfolioHistory(sim); } });
    }
  }

  // Sub-Tab 4: Calendar
  function renderPortfolioCalendar(sim) {
    const cal = sim.calendar;
    const st = sim.stats;

    // Row 1: Month & Week Cards
    propCalTopCards.innerHTML = `
      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);"><span>Best Month</span><span>Oct 2026</span></div>
        <div style="font-size:22px;font-family:var(--font-mono);font-weight:700;margin-top:6px;color:${rColor(cal.bestMonthNetPnl)};">${fmtDollar(cal.bestMonthNetPnl)}</div>
      </div>
      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);"><span>Worst Month</span><span>Oct 2026</span></div>
        <div style="font-size:22px;font-family:var(--font-mono);font-weight:700;margin-top:6px;color:${rColor(cal.worstMonthNetPnl)};">${fmtDollar(cal.worstMonthNetPnl)}</div>
      </div>
      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);"><span>Best Week</span><span>Week ${cal.bestWeek ? cal.bestWeek.week : 1}</span></div>
        <div style="font-size:22px;font-family:var(--font-mono);font-weight:700;margin-top:6px;color:${rColor(cal.bestWeek ? cal.bestWeek.netPnl : 0)};">${fmtDollar(cal.bestWeek ? cal.bestWeek.netPnl : 0)}</div>
      </div>
      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);"><span>Worst Week</span><span>Week ${cal.worstWeek ? cal.worstWeek.week : 1}</span></div>
        <div style="font-size:22px;font-family:var(--font-mono);font-weight:700;margin-top:6px;color:${rColor(cal.worstWeek ? cal.worstWeek.netPnl : 0)};">${fmtDollar(cal.worstWeek ? cal.worstWeek.netPnl : 0)}</div>
      </div>`;

    // Row 2: Streaks & Averages
    propCalStreaksCards.innerHTML = `
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Win Streak</div>
        <div style="font-size:22px;font-family:var(--font-mono);font-weight:700;margin-top:6px;color:var(--green-text);">${st.maxWinDays} days</div>
      </div>
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Loss Streak</div>
        <div style="font-size:22px;font-family:var(--font-mono);font-weight:700;margin-top:6px;color:var(--red-text);">${st.maxLossDays} days</div>
      </div>
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Profitable Days</div>
        <div style="font-size:22px;font-family:var(--font-mono);font-weight:700;margin-top:6px;">${st.profitableDaysPct.toFixed(1)}%</div>
      </div>
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Avg Trades / Day</div>
        <div style="font-size:22px;font-family:var(--font-mono);font-weight:700;margin-top:6px;">${st.avgTradesPerDay.toFixed(1)}</div>
      </div>`;

    // Calendar Days Cells
    const firstDayOfWeek = cal.calendarDays.length ? cal.calendarDays[0].dayOfWeek : 0;
    const emptyLeadCells = Array(firstDayOfWeek).fill(0).map(() => `<div class="prop-cal-cell empty"></div>`).join('');

    const dayCells = cal.calendarDays.map(d => {
      let stateClass = '';
      if (d.hasData) {
        stateClass = d.netPnl > 0 ? 'profit' : (d.netPnl < 0 ? 'loss' : '');
      }
      if (d.isToday) stateClass += ' today';

      const valText = d.hasData
        ? (state.calendarUnit === 'pct' ? fmtPercent((d.netPnl / 10000) * 100) : fmtDollar(d.netPnl))
        : '';

      return `
        <div class="prop-cal-cell ${stateClass}">
          <div style="display:flex;justify-content:space-between;">
            <span class="prop-cal-num">${d.day}</span>
            ${d.isToday ? '<span style="font-size:9px;color:var(--gold-text);font-weight:600;">TODAY</span>' : ''}
          </div>
          <div class="prop-cal-val" style="color:${rColor(d.netPnl)};">${valText}</div>
          <div class="prop-cal-sub">${d.hasData ? `${d.trades} Trades` : ''}</div>
        </div>`;
    }).join('');

    propCalendarGrid.innerHTML = emptyLeadCells + dayCells;

    // Donut Chart & Right Stats
    const winDays = cal.winningDaysCount;
    const lossDays = cal.losingDaysCount;
    const totalD = winDays + lossDays || 1;
    const winP = (winDays / totalD) * 100;

    propCalDonutWrap.innerHTML = `
      <svg width="180" height="110" viewBox="0 0 180 110">
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="16" stroke-linecap="round" />
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="#ef4444" stroke-width="16" stroke-linecap="round" />
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="#10b981" stroke-width="16" stroke-dasharray="220" stroke-dashoffset="${220 - (winP / 100) * 220}" stroke-linecap="round" />
        <text x="90" y="80" text-anchor="middle" font-size="20" font-weight="700" fill="var(--text)" font-family="var(--font-mono)">${winDays} / ${winDays + lossDays}</text>
        <text x="90" y="96" text-anchor="middle" font-size="9" fill="var(--text3)" text-transform="uppercase">Win / Loss Days</text>
      </svg>`;

    propCalSidebarStats.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--text2);">Trading Days</span><span class="mono">${st.tradingDaysCount}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--text2);">Day Win Rate</span><span class="mono" style="color:var(--green-text);">${st.profitableDaysPct.toFixed(1)}%</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--text2);">Winning Days</span><span class="mono" style="color:var(--green-text);">${winDays}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--text2);">Losing Days</span><span class="mono" style="color:var(--red-text);">${lossDays}</span></div>`;
  }

  // -------------------------------------------------------------------------
  // Bybit Mark Prices Fetcher
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
    }
  }

  setMode(state.mode);
  load();
  setInterval(load, 60000);
})();

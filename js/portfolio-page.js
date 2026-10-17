/* ==========================================================================
   Wicktor — Prop Firm Multi-Account Portfolio Page Script
   Manages 3 simulated $10,000 USDT accounts (Plan A, Plan B, Plan C)
   with strict 4% closed-trade daily drawdown resetting at Midnight UTC,
   8% max drawdown evaluated at midnight UTC, and no phase 1 end target.
   ========================================================================== */

(() => {
  const REST = 'https://laqytygibnlpdohouxaq.supabase.co/rest/v1/signal_journal';
  const KEY = 'sb_publishable_UVTLR2Ug_GjpHTEMXIeaJw_IJ1iI3xS';
  const LIST_LIMIT = 500;
  const BYBIT = 'https://api.bybit.com';

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
  const fmtPct2 = v => v == null ? '--' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  const fmtPercent = v => v == null ? '--' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  const fmtDollar = v => v == null ? '--' : (Number(v) >= 0 ? '+$' : '-$') + Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDollarPlain = v => v == null ? '--' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rColor = v => v == null ? 'var(--text3)' : (Number(v) >= 0 ? 'var(--green-text)' : 'var(--red-text)');

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

  // State
  const state = {
    selectedAccount: 'C', // 'A', 'B', or 'C'
    subtab: 'account-overview',
    calendarUnit: 'dollar',
    historySearch: '',
    historyPage: 1,
    historyPerPage: 10,
    statsRows: [],
    marks: {},
    portfolioOpts: {
      startingCapital: 10000,
      dailyDdLimitPct: 0.04,
      overallDdLimitPct: 0.08,
      maxConcurrentSlots: 5,
      riskPctPerTrade: 0.01,
      minScore: 85,
      feeRate: 0.0011,
      leverage: 5
    },
    multiSim: null
  };

  // DOM Elements - Switcher & Topbar
  const accountPills = document.querySelectorAll('.prop-account-pill');
  const toggleCompareBtn = document.getElementById('prop-toggle-compare-btn');
  const compareCard = document.getElementById('prop-compare-card');
  const compareTbody = document.getElementById('prop-compare-tbody');

  // DOM Elements - Header Banner
  const avatarEl = document.getElementById('prop-avatar');
  const titleTextEl = document.getElementById('prop-account-title-text');
  const subtitleEl = document.getElementById('prop-account-subtitle');
  const statusBadgeEl = document.getElementById('prop-account-status-badge');
  const cumChartPlanTag = document.getElementById('prop-cum-chart-plan-tag');

  // DOM Elements - Subtabs
  const subtabBtns = document.querySelectorAll('.prop-subtab-btn[data-subtab]');
  const subtabPanels = document.querySelectorAll('.prop-subtab-panel');
  const settingsToggleBtn = document.getElementById('prop-settings-toggle');
  const settingsPanel = document.getElementById('prop-settings-panel');

  // Subtab 1 Elements
  const objectivesGrid = document.getElementById('prop-objectives-grid');
  const statsCards = document.getElementById('prop-stats-cards');
  const chartContainer = document.getElementById('prop-chart-container');
  const pnlCard = document.getElementById('prop-pnl-card');
  const accountInfoCard = document.getElementById('prop-account-info-card');
  const tradingSummaryGrid = document.getElementById('prop-trading-summary-grid');

  // Subtab 2 Elements
  const overviewKpis = document.getElementById('prop-overview-kpis');
  const weekdayChart = document.getElementById('prop-weekday-chart');
  const sessionsGrid = document.getElementById('prop-sessions-grid');
  const cumulativeChart = document.getElementById('prop-cumulative-chart');
  const detailedStatsGrid = document.getElementById('prop-detailed-stats-grid');
  const dailyBarsChart = document.getElementById('prop-daily-bars-chart');
  const longshortCard = document.getElementById('prop-longshort-card');
  const recentSnippetCard = document.getElementById('prop-recent-snippet-card');

  // Subtab 3 Elements
  const historyTbody = document.getElementById('prop-history-tbody');
  const historySearch = document.getElementById('prop-history-search');
  const historyCountBadge = document.getElementById('prop-history-count-badge');
  const historyPagination = document.getElementById('prop-history-pagination');

  // Subtab 4 Elements
  const calMonthTitle = document.getElementById('prop-cal-month-title');
  const calUnitToggle = document.getElementById('prop-cal-unit-toggle');
  const calendarGrid = document.getElementById('prop-calendar-grid');
  const calDonutWrap = document.getElementById('prop-cal-donut-wrap');
  const calSidebarStats = document.getElementById('prop-cal-sidebar-stats');

  // -------------------------------------------------------------------------
  // Live Midnight UTC Countdown Timer (00:00:00 UTC)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Account Switcher & Comparison Logic
  // -------------------------------------------------------------------------
  function selectAccount(planKey) {
    state.selectedAccount = planKey;
    document.querySelectorAll('.prop-account-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.account === planKey);
    });

    const meta = {
      A: { num: 1, name: 'Plan A (Baseline)', code: 'A', avatar: '🛡️', sub: '1R Breakeven · 2R Target · $10,000 USDT · Regular Score ≥ 85' },
      B: { num: 2, name: 'Plan B (Baseline)', code: 'B', avatar: '🎯', sub: 'Pure 3R Runner · Fixed Stop · $10,000 USDT · Regular Score ≥ 85' },
      C: { num: 3, name: 'Plan C (Baseline)', code: 'C', avatar: '⚡', sub: 'Dynamic 0.5R Trail · Scale-Out · $10,000 USDT · Regular Score ≥ 85' },
      A_WM: { num: 4, name: 'Plan A (WM Combined)', code: 'A-WMC', avatar: '🌪️', sub: '1R Breakeven · 2R Target · $10,000 USDT · WM Combined Momentum (All Sub-Filters)' },
      B_WM: { num: 5, name: 'Plan B (WM Combined)', code: 'B-WMC', avatar: '🚀', sub: 'Pure 3R Runner · Fixed Stop · $10,000 USDT · WM Combined Momentum (All Sub-Filters)' },
      C_WM: { num: 6, name: 'Plan C (WM Combined)', code: 'C-WMC', avatar: '💎', sub: 'Dynamic 0.5R Trail · Scale-Out · $10,000 USDT · WM Combined Momentum (All Sub-Filters)' },
      C_WM_PERP: { num: 7, name: 'Plan C (WM Perps Only)', code: 'C-PERP', avatar: '🔥', sub: 'Dynamic 0.5R Trail · Scale-Out · $10,000 USDT · WM Combined · Bybit PERPs Only' },
      H_WM_PERP: { num: 8, name: 'Conviction Harvest (WM Perps Only)', code: 'H-PERP', avatar: '🎯', sub: 'Score-Adaptive · Dual Target 2R/3.5R (Score ≥87) · $10,000 USDT · WM Combined · Bybit PERPs Only' }
    }[planKey] || { num: 3, name: 'Plan C', code: 'C', avatar: '⚡', sub: '$10,000 USDT' };

    if (avatarEl) avatarEl.textContent = meta.avatar;
    if (titleTextEl) titleTextEl.textContent = `Account ${meta.num} — ${meta.name} (#W3-10000${meta.code})`;
    if (subtitleEl) subtitleEl.textContent = `Funded Account (No Phase 1 Limit) · ${meta.sub}`;
    if (cumChartPlanTag) cumChartPlanTag.textContent = `${meta.name} Realized Performance`;

    renderActiveAccount();
  }

  accountPills.forEach(pill => {
    pill.addEventListener('click', () => selectAccount(pill.dataset.account));
  });

  if (toggleCompareBtn && compareCard) {
    toggleCompareBtn.addEventListener('click', () => {
      const isHidden = compareCard.style.display === 'none';
      compareCard.style.display = isHidden ? 'block' : 'none';
      toggleCompareBtn.classList.toggle('active', isHidden);
    });
  }

  // -------------------------------------------------------------------------
  // Sub-Tabs Switching
  // -------------------------------------------------------------------------
  function setSubtab(subtabId) {
    state.subtab = subtabId;
    subtabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === subtabId);
    });
    subtabPanels.forEach(panel => {
      panel.style.display = panel.id === `subtab-${subtabId}` ? 'block' : 'none';
    });
    renderActiveAccount();
  }

  subtabBtns.forEach(btn => {
    btn.addEventListener('click', () => setSubtab(btn.dataset.subtab));
  });

  if (settingsToggleBtn && settingsPanel) {
    settingsToggleBtn.addEventListener('click', () => {
      const isHidden = settingsPanel.style.display === 'none';
      settingsPanel.style.display = isHidden ? 'block' : 'none';
      settingsToggleBtn.classList.toggle('active', isHidden);
    });
  }

  // Parameter Controls
  function setupSimulationControls() {
    const bindChips = (containerId, optKey, parseFn) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.querySelectorAll('button[data-' + optKey.toLowerCase() + ']').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.portfolioOpts[optKey] = parseFn(btn.dataset[optKey.toLowerCase()]);
          recalculateAndRender();
        });
      });
    };

    bindChips('filter-score-chips', 'minScore', Number);
    bindChips('filter-slots-chips', 'maxConcurrentSlots', Number);
    bindChips('filter-risk-chips', 'riskPctPerTrade', parseFloat);
    bindChips('filter-lev-chips', 'leverage', Number);

    if (calUnitToggle) {
      calUnitToggle.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          calUnitToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.calendarUnit = btn.dataset.unit;
          if (state.multiSim) {
            const currentSim = getActiveSim();
            renderCalendar(currentSim);
          }
        });
      });
    }

    if (historySearch) {
      historySearch.addEventListener('input', e => {
        state.historySearch = e.target.value.trim().toUpperCase();
        state.historyPage = 1;
        if (state.multiSim) {
          const currentSim = getActiveSim();
          renderHistory(currentSim);
        }
      });
    }
  }
  setupSimulationControls();

  // -------------------------------------------------------------------------
  // Main Recalculate & Render Routine
  // -------------------------------------------------------------------------
  function recalculateAndRender() {
    if (!window.PortfolioSimulator) return;

    // Simulate all 3 accounts simultaneously
    state.multiSim = window.PortfolioSimulator.simulateMulti(state.statsRows, {
      ...state.portfolioOpts,
      liveMarks: state.marks
    });

    renderPillBadges();
    renderComparisonTable();
    renderActiveAccount();
  }

  // Helper to obtain simulation result for the selected account
  function getActiveSim() {
    if (!state.multiSim) return null;
    switch (state.selectedAccount) {
      case 'A': return state.multiSim.planA;
      case 'B': return state.multiSim.planB;
      case 'C': return state.multiSim.planC;
      case 'A_WM': return state.multiSim.planA_wm;
      case 'B_WM': return state.multiSim.planB_wm;
      case 'C_WM': return state.multiSim.planC_wm;
      case 'C_WM_PERP': return state.multiSim.planC_wm_perp;
      case 'H_WM_PERP': return state.multiSim.planH_wm_perp;
      default: return state.multiSim.planC;
    }
  }

  // Update mini metrics on account switcher pills (All 8 Accounts)
  function renderPillBadges() {
    if (!state.multiSim) return;
    const { planA, planB, planC, planA_wm, planB_wm, planC_wm, planC_wm_perp, planH_wm_perp } = state.multiSim;

    const updatePill = (k, sim) => {
      if (!sim) return;
      const pnlEl = document.getElementById(`pill-pnl-${k}`);
      const subEl = document.getElementById(`pill-sub-${k}`);
      const badgeEl = document.getElementById(`pill-badge-${k}`);

      if (pnlEl) {
        pnlEl.textContent = fmtDollar(sim.summary.netProfit);
        pnlEl.style.color = rColor(sim.summary.netProfit);
      }
      if (subEl) {
        subEl.textContent = `${sim.summary.winRatePct.toFixed(1)}% WR · ${sim.summary.totalTrades} Trades · ${fmtPercent(sim.summary.netRoiPct)}`;
      }
      if (badgeEl) {
        if (sim.summary.isAccountBreached) {
          badgeEl.className = 'prop-badge-halted';
          badgeEl.textContent = 'Breached (8% DD)';
        } else if (sim.summary.isDailyHalted) {
          badgeEl.className = 'prop-badge-halted';
          badgeEl.textContent = 'Daily Halted';
        } else if (k === 'C_WM_PERP' || k === 'H_WM_PERP') {
          badgeEl.className = 'prop-badge-perp';
          badgeEl.textContent = k === 'H_WM_PERP' ? 'Active · Conviction' : 'Active · Perps Only';
        } else {
          badgeEl.className = k.includes('WM') ? 'prop-badge-wm' : 'prop-badge-active';
          badgeEl.textContent = k.includes('WM') ? 'Active · WM' : 'Active (Live)';
        }
      }
    };

    updatePill('A', planA);
    updatePill('B', planB);
    updatePill('C', planC);
    updatePill('A_WM', planA_wm);
    updatePill('B_WM', planB_wm);
    updatePill('C_WM', planC_wm);
    updatePill('C_WM_PERP', planC_wm_perp);
    updatePill('H_WM_PERP', planH_wm_perp);
  }

  // Render Side-by-Side 8-Account Comparison Table
  function renderComparisonTable() {
    if (!compareTbody || !state.multiSim) return;
    const { planA, planB, planC, planA_wm, planB_wm, planC_wm, planC_wm_perp, planH_wm_perp } = state.multiSim;

    const row = (label, aVal, bVal, cVal, aWmVal, bWmVal, cWmVal, cWmPerpVal, hWmPerpVal, isMono = true) => `
      <tr>
        <td><strong>${label}</strong></td>
        <td ${isMono ? 'class="mono"' : ''}>${aVal}</td>
        <td ${isMono ? 'class="mono"' : ''}>${bVal}</td>
        <td ${isMono ? 'class="mono"' : ''}>${cVal}</td>
        <td ${isMono ? 'class="mono"' : ''} style="background:rgba(6,182,212,0.03);">${aWmVal}</td>
        <td ${isMono ? 'class="mono"' : ''} style="background:rgba(6,182,212,0.03);">${bWmVal}</td>
        <td ${isMono ? 'class="mono"' : ''} style="background:rgba(6,182,212,0.03);">${cWmVal}</td>
        <td ${isMono ? 'class="mono"' : ''} style="background:rgba(239,68,68,0.04);">${cWmPerpVal}</td>
        <td ${isMono ? 'class="mono"' : ''} style="background:rgba(16,185,129,0.04);">${hWmPerpVal}</td>
      </tr>`;

    compareTbody.innerHTML =
      row('Net Profit ($)', `<span style="color:${rColor(planA.summary.netProfit)}">${fmtDollar(planA.summary.netProfit)}</span>`,
                            `<span style="color:${rColor(planB.summary.netProfit)}">${fmtDollar(planB.summary.netProfit)}</span>`,
                            `<span style="color:${rColor(planC.summary.netProfit)}">${fmtDollar(planC.summary.netProfit)}</span>`,
                            `<span style="color:${rColor(planA_wm.summary.netProfit)}">${fmtDollar(planA_wm.summary.netProfit)}</span>`,
                            `<span style="color:${rColor(planB_wm.summary.netProfit)}">${fmtDollar(planB_wm.summary.netProfit)}</span>`,
                            `<span style="color:${rColor(planC_wm.summary.netProfit)}">${fmtDollar(planC_wm.summary.netProfit)}</span>`,
                            `<span style="color:${rColor(planC_wm_perp.summary.netProfit)}">${fmtDollar(planC_wm_perp.summary.netProfit)}</span>`,
                            `<span style="color:${rColor(planH_wm_perp.summary.netProfit)}">${fmtDollar(planH_wm_perp.summary.netProfit)}</span>`) +
      row('Return on Capital (ROI)', `<span style="color:${rColor(planA.summary.netRoiPct)}">${fmtPercent(planA.summary.netRoiPct)}</span>`,
                                    `<span style="color:${rColor(planB.summary.netRoiPct)}">${fmtPercent(planB.summary.netRoiPct)}</span>`,
                                    `<span style="color:${rColor(planC.summary.netRoiPct)}">${fmtPercent(planC.summary.netRoiPct)}</span>`,
                                    `<span style="color:${rColor(planA_wm.summary.netRoiPct)}">${fmtPercent(planA_wm.summary.netRoiPct)}</span>`,
                                    `<span style="color:${rColor(planB_wm.summary.netRoiPct)}">${fmtPercent(planB_wm.summary.netRoiPct)}</span>`,
                                    `<span style="color:${rColor(planC_wm.summary.netRoiPct)}">${fmtPercent(planC_wm.summary.netRoiPct)}</span>`,
                                    `<span style="color:${rColor(planC_wm_perp.summary.netRoiPct)}">${fmtPercent(planC_wm_perp.summary.netRoiPct)}</span>`,
                                    `<span style="color:${rColor(planH_wm_perp.summary.netRoiPct)}">${fmtPercent(planH_wm_perp.summary.netRoiPct)}</span>`) +
      row('Win Rate %', `${planA.summary.winRatePct.toFixed(2)}%`, `${planB.summary.winRatePct.toFixed(2)}%`, `${planC.summary.winRatePct.toFixed(2)}%`,
                        `${planA_wm.summary.winRatePct.toFixed(2)}%`, `${planB_wm.summary.winRatePct.toFixed(2)}%`, `${planC_wm.summary.winRatePct.toFixed(2)}%`,
                        `${planC_wm_perp.summary.winRatePct.toFixed(2)}%`,
                        `${planH_wm_perp.summary.winRatePct.toFixed(2)}%`) +
      row('Profit Factor', planA.summary.profitFactor.toFixed(2), planB.summary.profitFactor.toFixed(2), planC.summary.profitFactor.toFixed(2),
                           planA_wm.summary.profitFactor.toFixed(2), planB_wm.summary.profitFactor.toFixed(2), planC_wm.summary.profitFactor.toFixed(2),
                           planC_wm_perp.summary.profitFactor.toFixed(2),
                           planH_wm_perp.summary.profitFactor.toFixed(2)) +
      row('Total Trades (W / L)', `${planA.summary.totalTrades} (${planA.summary.wins}W / ${planA.summary.losses}L)`,
                                  `${planB.summary.totalTrades} (${planB.summary.wins}W / ${planB.summary.losses}L)`,
                                  `${planC.summary.totalTrades} (${planC.summary.wins}W / ${planC.summary.losses}L)`,
                                  `${planA_wm.summary.totalTrades} (${planA_wm.summary.wins}W / ${planA_wm.summary.losses}L)`,
                                  `${planB_wm.summary.totalTrades} (${planB_wm.summary.wins}W / ${planB_wm.summary.losses}L)`,
                                  `${planC_wm.summary.totalTrades} (${planC_wm.summary.wins}W / ${planC_wm.summary.losses}L)`,
                                  `${planC_wm_perp.summary.totalTrades} (${planC_wm_perp.summary.wins}W / ${planC_wm_perp.summary.losses}L)`,
                                  `${planH_wm_perp.summary.totalTrades} (${planH_wm_perp.summary.wins}W / ${planH_wm_perp.summary.losses}L)`) +
      row('Avg Realized R:R', planA.stats.avgRealizedRr.toFixed(2), planB.stats.avgRealizedRr.toFixed(2), planC.stats.avgRealizedRr.toFixed(2),
                             planA_wm.stats.avgRealizedRr.toFixed(2), planB_wm.stats.avgRealizedRr.toFixed(2), planC_wm.stats.avgRealizedRr.toFixed(2),
                             planC_wm_perp.stats.avgRealizedRr.toFixed(2),
                             planH_wm_perp.stats.avgRealizedRr.toFixed(2)) +
      row('Daily Drawdown Peak', `${planA.summary.maxDailyDdEncounteredPct.toFixed(2)}%`, `${planB.summary.maxDailyDdEncounteredPct.toFixed(2)}%`, `${planC.summary.maxDailyDdEncounteredPct.toFixed(2)}%`,
                                 `${planA_wm.summary.maxDailyDdEncounteredPct.toFixed(2)}%`, `${planB_wm.summary.maxDailyDdEncounteredPct.toFixed(2)}%`, `${planC_wm.summary.maxDailyDdEncounteredPct.toFixed(2)}%`,
                                 `${planC_wm_perp.summary.maxDailyDdEncounteredPct.toFixed(2)}%`,
                                 `${planH_wm_perp.summary.maxDailyDdEncounteredPct.toFixed(2)}%`) +
      row('Midnight UTC Max DD', `${planA.summary.maxOverallDdEncounteredPct.toFixed(2)}%`, `${planB.summary.maxOverallDdEncounteredPct.toFixed(2)}%`, `${planC.summary.maxOverallDdEncounteredPct.toFixed(2)}%`,
                                 `${planA_wm.summary.maxOverallDdEncounteredPct.toFixed(2)}%`, `${planB_wm.summary.maxOverallDdEncounteredPct.toFixed(2)}%`, `${planC_wm.summary.maxOverallDdEncounteredPct.toFixed(2)}%`,
                                 `${planC_wm_perp.summary.maxOverallDdEncounteredPct.toFixed(2)}%`,
                                 `${planH_wm_perp.summary.maxOverallDdEncounteredPct.toFixed(2)}%`) +
      row('Bybit Fees Paid', fmtDollarPlain(planA.summary.totalFeesPaid), fmtDollarPlain(planB.summary.totalFeesPaid), fmtDollarPlain(planC.summary.totalFeesPaid),
                             fmtDollarPlain(planA_wm.summary.totalFeesPaid), fmtDollarPlain(planB_wm.summary.totalFeesPaid), fmtDollarPlain(planC_wm.summary.totalFeesPaid),
                             fmtDollarPlain(planC_wm_perp.summary.totalFeesPaid),
                             fmtDollarPlain(planH_wm_perp.summary.totalFeesPaid)) +
      row('Best / Worst Trade', `${fmtDollar(planA.stats.bestTrade?.netPnl)} / ${fmtDollar(planA.stats.worstTrade?.netPnl)}`,
                                `${fmtDollar(planB.stats.bestTrade?.netPnl)} / ${fmtDollar(planB.stats.worstTrade?.netPnl)}`,
                                `${fmtDollar(planC.stats.bestTrade?.netPnl)} / ${fmtDollar(planC.stats.worstTrade?.netPnl)}`,
                                `${fmtDollar(planA_wm.stats.bestTrade?.netPnl)} / ${fmtDollar(planA_wm.stats.worstTrade?.netPnl)}`,
                                `${fmtDollar(planB_wm.stats.bestTrade?.netPnl)} / ${fmtDollar(planB_wm.stats.worstTrade?.netPnl)}`,
                                `${fmtDollar(planC_wm.stats.bestTrade?.netPnl)} / ${fmtDollar(planC_wm.stats.worstTrade?.netPnl)}`,
                                `${fmtDollar(planC_wm_perp.stats.bestTrade?.netPnl)} / ${fmtDollar(planC_wm_perp.stats.worstTrade?.netPnl)}`,
                                `${fmtDollar(planH_wm_perp.stats.bestTrade?.netPnl)} / ${fmtDollar(planH_wm_perp.stats.worstTrade?.netPnl)}`) +
      row('Account Status', planA.summary.statusText, planB.summary.statusText, planC.summary.statusText,
                            planA_wm.summary.statusText, planB_wm.summary.statusText, planC_wm.summary.statusText,
                            planC_wm_perp.summary.statusText, planH_wm_perp.summary.statusText, false);
  }

  // Render whichever account is currently selected (A, B, C, A_WM, B_WM, C_WM)
  function renderActiveAccount() {
    if (!state.multiSim) return;
    const sim = getActiveSim();
    if (!sim) return;

    const s = sim.summary;

    if (statusBadgeEl) {
      if (s.isAccountBreached) {
        statusBadgeEl.className = 'prop-badge-halted';
        statusBadgeEl.textContent = 'Breached (8% DD Floor)';
      } else if (s.isDailyHalted) {
        statusBadgeEl.className = 'prop-badge-halted';
        statusBadgeEl.textContent = 'Halted (4% Daily Limit)';
      } else {
        statusBadgeEl.className = 'prop-badge-active';
        statusBadgeEl.textContent = 'Funded / Active (No End Target)';
      }
    }

    if (state.subtab === 'account-overview') renderAccountOverview(sim);
    else if (state.subtab === 'trading-overview') renderTradingOverview(sim);
    else if (state.subtab === 'trading-history') renderHistory(sim);
    else if (state.subtab === 'calendar') renderCalendar(sim);
  }

  // -------------------------------------------------------------------------
  // SUB-TAB 1: Account Overview
  // -------------------------------------------------------------------------
  function renderAccountOverview(sim) {
    if (!objectivesGrid) return;
    const o = sim.objectives;
    const s = sim.summary;
    const st = sim.stats;

    // 1. Objectives Grid (Funded Account - No Phase 1 Ceiling)
    objectivesGrid.innerHTML = `
      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);font-weight:500;">Daily Loss Limit (4.0%)</span>
          <span style="font-size:11px;font-family:var(--font-mono);background:var(--surf2);padding:2px 6px;border-radius:4px;color:var(--text3);">${fmtDollarPlain(o.dailyDdLevel)}</span>
        </div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:10px 0 4px;color:var(--text);">
          ${fmtDollarPlain(o.dailyDdLeft)} <span style="font-size:13px;color:var(--text3);font-weight:normal;">left</span>
        </div>
        <div class="prop-progress-track">
          <div class="prop-progress-fill-coral" style="width:${Math.max(2, o.dailyUsedPct)}%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px;">
          <span>${o.dailyUsedPct.toFixed(1)}% used (-$${s.currentDailyLoss.toFixed(2)})</span>
          <span>Resets Midnight UTC (00:00:00)</span>
        </div>
      </div>

      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);font-weight:500;">Max Drawdown Limit (8.0%)</span>
          <span style="font-size:11px;font-family:var(--font-mono);background:var(--surf2);padding:2px 6px;border-radius:4px;color:var(--text3);">${fmtDollarPlain(o.maxDdLevel)} floor</span>
        </div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:10px 0 4px;color:var(--text);">
          ${fmtDollarPlain(o.maxDdLeft)} <span style="font-size:13px;color:var(--text3);font-weight:normal;">left</span>
        </div>
        <div class="prop-progress-track">
          <div class="prop-progress-fill-coral" style="width:${Math.max(2, o.maxUsedPct)}%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px;">
          <span>${o.maxUsedPct.toFixed(1)}% used (-$${s.currentOverallLoss.toFixed(2)})</span>
          <span>Evaluated Midnight UTC on closing capital</span>
        </div>
      </div>

      <div class="prop-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text2);font-weight:500;">Total Net Profit & Growth</span>
          <span style="font-size:11px;font-family:var(--font-mono);background:var(--surf2);padding:2px 6px;border-radius:4px;color:var(--green-text);">${fmtPercent(s.netRoiPct)}</span>
        </div>
        <div style="font-size:26px;font-family:var(--font-mono);font-weight:700;margin:10px 0 4px;color:${rColor(s.netProfit)};">
          ${fmtDollar(s.netProfit)}
        </div>
        <div class="prop-progress-track">
          <div class="prop-progress-fill-emerald" style="width:100%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px;">
          <span>Continuous Capital Accumulation</span>
          <span style="color:var(--green-text);">No End Target</span>
        </div>
      </div>`;

    // 2. SVG Balance Chart
    renderBalanceCurveChart(sim.curvePoints, sim.summary.startingCapital);

    // 3. Profit / Loss Details Cards
    if (pnlCard) {
      pnlCard.innerHTML = `
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Net Realized Profit</div>
        <div style="font-size:28px;font-family:var(--font-mono);font-weight:700;margin:6px 0 10px;color:${rColor(s.netProfit)};">
          ${fmtDollar(s.netProfit)}
        </div>
        <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:10px;margin-top:6px;">
          <span style="font-size:12px;color:var(--text2);">Profit Split</span>
          <span style="font-size:13px;font-weight:600;color:var(--text);">${st.profitSplit}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;">
          <span style="font-size:12px;color:var(--text2);">Account Mode</span>
          <span style="font-size:13px;font-weight:600;color:var(--gold-text);">${st.accountPhase}</span>
        </div>`;
    }

    if (accountInfoCard) {
      accountInfoCard.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;color:var(--text2);">Current Equity</span>
            <span style="font-size:15px;font-family:var(--font-mono);font-weight:700;color:${rColor(s.netProfit)};">${fmtDollarPlain(s.currentEquity)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;color:var(--text2);">Closed Balance</span>
            <span style="font-size:15px;font-family:var(--font-mono);font-weight:700;">${fmtDollarPlain(s.currentBalance)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;color:var(--text2);">Execution Plan</span>
            <span style="font-size:12px;font-weight:600;color:var(--text);">Plan ${sim.plan}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;color:var(--text2);">Initial Capital</span>
            <span style="font-size:13px;font-family:var(--font-mono);font-weight:600;">${fmtDollarPlain(s.startingCapital)}</span>
          </div>
        </div>`;
    }

    // 4. Stats Cards
    if (statsCards) {
      statsCards.innerHTML = `
        <div class="prop-card">
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Trading Days Active</div>
          <div style="font-size:24px;font-family:var(--font-mono);font-weight:700;margin-top:6px;">${st.tradingDaysCount} Days</div>
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
    }

    // 5. Win Rate & Profit Factor Dual Bars
    if (tradingSummaryGrid) {
      const winRatio = s.totalTrades ? (s.wins / s.totalTrades) * 100 : 50;
      const lossRatio = 100 - winRatio;

      tradingSummaryGrid.innerHTML = `
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
            <span>Gross Wins / Losses</span>
            <span style="color:${s.profitFactor >= 1.5 ? 'var(--green-text)' : 'var(--gold-text)'};">Benchmark &gt; 1.50</span>
          </div>
        </div>`;
    }
  }

  // SVG Balance Curve Chart
  function renderBalanceCurveChart(points, startingCapital) {
    if (!chartContainer) return;
    if (!points || points.length < 2) {
      chartContainer.innerHTML = '<div class="empty-state">Not enough trade data for balance curve yet.</div>';
      return;
    }

    const W = chartContainer.clientWidth || 550;
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

    const maxDdY = scaleY(9200);
    const startY = scaleY(startingCapital);

    chartContainer.innerHTML = `
      <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible;">
        <line x1="${padX}" y1="${startY}" x2="${W - padX}" y2="${startY}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
        <text x="${padX - 8}" y="${startY + 4}" fill="var(--text3)" font-size="9" text-anchor="end" font-family="var(--font-mono)">$10k</text>

        <line x1="${padX}" y1="${maxDdY}" x2="${W - padX}" y2="${maxDdY}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,4" opacity="0.65" />
        <text x="${padX - 8}" y="${maxDdY + 4}" fill="#f59e0b" font-size="9" text-anchor="end" font-family="var(--font-mono)">$9.2k Floor</text>

        <path d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${points.map((p, i) => `<circle cx="${scaleX(i).toFixed(1)}" cy="${scaleY(p.balance).toFixed(1)}" r="3" fill="#38bdf8" />`).join('')}
      </svg>`;
  }

  // -------------------------------------------------------------------------
  // SUB-TAB 2: Trading Overview (FIXED & FULLY DEFENSIVE)
  // -------------------------------------------------------------------------
  function renderTradingOverview(sim) {
    if (!overviewKpis) return;
    const s = sim.summary;
    const st = sim.stats;

    // Row 1: KPI Cards
    overviewKpis.innerHTML = `
      <div class="prop-card">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;">Net Realized P&L</div>
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
        <div style="font-size:11px;color:var(--text2);">Plan ${sim.plan} Execution</div>
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

    // Row 2: Weekday Distribution Bar Chart
    if (weekdayChart) {
      const weekdays = sim.weekdayDistribution || [];
      const maxDayTrades = Math.max(1, ...weekdays.map(w => w.trades));
      weekdayChart.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-end;height:140px;gap:8px;padding-top:10px;">
          ${weekdays.map(w => {
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
    }

    // Row 2: Sessions Grid
    if (sessionsGrid && sim.sessions) {
      sessionsGrid.innerHTML = Object.entries(sim.sessions).map(([k, sess]) => `
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
    }

    // Row 3: Cumulative PnL Area Chart
    renderCumulativePnlChart(sim.curvePoints);

    // Row 4: Detailed Statistics Grid
    if (detailedStatsGrid) {
      detailedStatsGrid.innerHTML = `
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
    }

    // Row 5: Daily Net P&L Bars Chart
    renderDailyBarsChart(sim.dailyLedger);

    // Row 6: Long / Short Performance Card
    if (longshortCard && sim.longShortStats) {
      const ls = sim.longShortStats;
      longshortCard.innerHTML = `
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
    }

    // Row 6: Active Portfolio Slots Snippet
    if (recentSnippetCard) {
      recentSnippetCard.innerHTML = `
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
  }

  // Cumulative PnL Area Chart SVG
  function renderCumulativePnlChart(points) {
    if (!cumulativeChart) return;
    if (!points || points.length < 2) {
      cumulativeChart.innerHTML = '<div class="empty-state">No cumulative trade points yet.</div>';
      return;
    }

    const W = cumulativeChart.clientWidth || 700;
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

    cumulativeChart.innerHTML = `
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

  // Daily Bars Chart SVG
  function renderDailyBarsChart(dailyList) {
    if (!dailyBarsChart) return;
    const days = (dailyList || []).filter(d => d.tradesCount > 0).slice().reverse();
    if (!days.length) {
      dailyBarsChart.innerHTML = '<div class="empty-state">No daily closed trade data yet.</div>';
      return;
    }

    const maxAbs = Math.max(10, ...days.map(d => Math.abs(d.netPnl)));
    dailyBarsChart.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;height:120px;gap:12px;padding:10px 0;overflow-x:auto;">
        ${days.map(d => {
          const isPos = d.netPnl >= 0;
          const pctHeight = (Math.abs(d.netPnl) / maxAbs) * 50;
          return `
          <div style="flex:1;min-width:38px;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:center;">
            <div style="height:50px;display:flex;align-items:flex-end;">
              ${isPos ? `<div style="width:20px;background:#10b981;height:${Math.max(6, pctHeight)}px;border-radius:3px 3px 0 0;" title="${d.date}: ${fmtDollar(d.netPnl)}"></div>` : ''}
            </div>
            <div style="width:100%;height:1px;background:rgba(255,255,255,0.2);"></div>
            <div style="height:50px;display:flex;align-items:flex-start;">
              ${!isPos ? `<div style="width:20px;background:#ef4444;height:${Math.max(6, pctHeight)}px;border-radius:0 0 3px 3px;" title="${d.date}: ${fmtDollar(d.netPnl)}"></div>` : ''}
            </div>
            <div style="font-size:10px;font-family:var(--font-mono);margin-top:4px;">${d.date.slice(5)}</div>
            <div style="font-size:10px;font-weight:600;color:${rColor(d.netPnl)};">${fmtDollar(d.netPnl)}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  // -------------------------------------------------------------------------
  // SUB-TAB 3: Trading History
  // -------------------------------------------------------------------------
  function renderHistory(sim) {
    if (!historyTbody) return;

    let trades = (sim.closedTrades || []).slice();
    if (state.historySearch) {
      trades = trades.filter(t => t.symbol.toUpperCase().includes(state.historySearch));
    }

    if (historyCountBadge) {
      historyCountBadge.textContent = `${trades.length} trades recorded`;
    }

    if (!trades.length) {
      historyTbody.innerHTML = '<tr><td colspan="11" class="empty-state">No matching trade history found.</td></tr>';
      if (historyPagination) historyPagination.innerHTML = '';
      return;
    }

    const totalPages = Math.ceil(trades.length / state.historyPerPage);
    state.historyPage = Math.min(state.historyPage, totalPages);
    const startIdx = (state.historyPage - 1) * state.historyPerPage;
    const pageTrades = trades.slice(startIdx, startIdx + state.historyPerPage);

    historyTbody.innerHTML = pageTrades.map((t, i) => {
      const ticketId = `#${1001 + startIdx + i}`;
      const sideClass = t.direction === 1 ? 'prop-badge-buy' : 'prop-badge-sell';
      const sideText = t.direction === 1 ? 'BUY' : 'SELL';
      const openDate = new Date(t.bar_time).toLocaleString();
      const closeDate = t.exitTime ? new Date(t.exitTime).toLocaleString() : '--';
      const durText = t.duration_min != null ? fmtDuration(t.duration_min) : '--';
      const isWin = t.netPnl > 0;
      const isLoss = t.netPnl < 0;

      let badgeBg = 'rgba(255,255,255,0.06)';
      let badgeCol = 'var(--text2)';
      if (isWin) {
        badgeBg = 'rgba(16,185,129,0.15)';
        badgeCol = 'var(--green-text)';
      } else if (isLoss) {
        badgeBg = 'rgba(239,68,68,0.15)';
        badgeCol = 'var(--red-text)';
      }

      return `
        <tr>
          <td class="mono" style="color:var(--text3);font-size:11px;">${ticketId}</td>
          <td style="font-size:11px;color:var(--text3);white-space:nowrap;">${openDate}</td>
          <td style="font-size:11px;color:var(--text3);white-space:nowrap;">${closeDate}</td>
          <td><strong>${esc(t.symbol.replace(/USDT$/, ''))}</strong> <span style="font-size:10px;color:var(--text3);">${esc(t.market)}</span></td>
          <td><span class="${sideClass}">${sideText}</span></td>
          <td class="mono">${fmtPrice(t.entry)}</td>
          <td class="mono">${fmtPrice(t.target)}</td>
          <td class="mono" style="color:${rColor(t.outcome_r)};font-weight:600;">${fmtR(t.outcome_r)}</td>
          <td class="mono" style="color:${rColor(t.netPnl)};font-weight:700;">${fmtDollar(t.netPnl)}</td>
          <td class="mono" style="font-size:11px;color:var(--text2);">${durText}</td>
          <td>
            <span style="background:${badgeBg};color:${badgeCol};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;text-transform:capitalize;">
              ${esc(t.exit_reason || 'resolved')}
            </span>
          </td>
        </tr>`;
    }).join('');

    // Pagination
    if (historyPagination) {
      if (totalPages <= 1) {
        historyPagination.innerHTML = '';
        return;
      }
      historyPagination.innerHTML = `
        <button class="chip" ${state.historyPage === 1 ? 'disabled style="opacity:0.4;"' : ''} id="btn-page-prev">&larr; Prev</button>
        <span style="font-size:12px;color:var(--text3);">Page ${state.historyPage} of ${totalPages}</span>
        <button class="chip" ${state.historyPage === totalPages ? 'disabled style="opacity:0.4;"' : ''} id="btn-page-next">Next &rarr;</button>`;

      const prev = document.getElementById('btn-page-prev');
      const next = document.getElementById('btn-page-next');
      if (prev) prev.addEventListener('click', () => { state.historyPage--; renderHistory(sim); });
      if (next) next.addEventListener('click', () => { state.historyPage++; renderHistory(sim); });
    }
  }

  // -------------------------------------------------------------------------
  // SUB-TAB 4: Monthly Calendar
  // -------------------------------------------------------------------------
  function renderCalendar(sim) {
    if (!calendarGrid || !sim.calendar) return;
    const cal = sim.calendar;
    const st = sim.stats;

    if (calMonthTitle) {
      calMonthTitle.textContent = `${cal.monthName} ${cal.currentYear}`;
    }

    const firstDayOfWeek = cal.calendarDays[0] ? cal.calendarDays[0].dayOfWeek : 0;
    let emptyLeadCells = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
      emptyLeadCells += '<div class="prop-cal-cell empty"></div>';
    }

    const dayCells = cal.calendarDays.map(d => {
      let stateClass = '';
      if (d.hasData) {
        stateClass = d.netPnl >= 0 ? 'profit' : 'loss';
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

    calendarGrid.innerHTML = emptyLeadCells + dayCells;

    // Donut Chart & Right Stats
    const winDays = cal.winningDaysCount;
    const lossDays = cal.losingDaysCount;
    const totalD = winDays + lossDays || 1;
    const winP = (winDays / totalD) * 100;

    if (calDonutWrap) {
      calDonutWrap.innerHTML = `
        <svg width="180" height="110" viewBox="0 0 180 110">
          <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="16" stroke-linecap="round" />
          <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="#ef4444" stroke-width="16" stroke-linecap="round" />
          <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="#10b981" stroke-width="16" stroke-dasharray="220" stroke-dashoffset="${220 - (winP / 100) * 220}" stroke-linecap="round" />
          <text x="90" y="80" text-anchor="middle" font-size="20" font-weight="700" fill="var(--text)" font-family="var(--font-mono)">${winDays} / ${winDays + lossDays}</text>
          <text x="90" y="96" text-anchor="middle" font-size="9" fill="var(--text3)" text-transform="uppercase">Win / Loss Days</text>
        </svg>`;
    }

    if (calSidebarStats) {
      calSidebarStats.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--text2);">Trading Days</span><span class="mono">${st.tradingDaysCount}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--text2);">Day Win Rate</span><span class="mono" style="color:var(--green-text);">${st.profitableDaysPct.toFixed(1)}%</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--text2);">Winning Days</span><span class="mono" style="color:var(--green-text);">${winDays}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;"><span style="color:var(--text2);">Losing Days</span><span class="mono" style="color:var(--red-text);">${lossDays}</span></div>`;
    }
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        let res;
        try {
          res = await fetch(`${BYBIT}/v5/market/tickers?category=${category}`, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok) return;
        const data = await res.json();
        if (data.retCode !== 0) return;
        const market = category === 'linear' ? 'PERP' : 'SPOT';
        for (const t of data.result.list) out[`${t.symbol}:${market}`] = parseFloat(t.lastPrice);
      } catch (e) { console.warn('[PortfolioPage] mark price fetch failed', category, e.message); }
    }
  }

  // -------------------------------------------------------------------------
  // Data Loader
  // -------------------------------------------------------------------------
  const syncStatusEl = document.getElementById('prop-sync-status');

  async function fetchAllRows(urlBase, headers) {
    const rows = [];
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      let res;
      try {
        res = await fetch(urlBase, { headers: { ...headers, Range: `${offset}-${offset + PAGE - 1}` }, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = await res.json();
      rows.push(...page);
      const total = Number((res.headers && typeof res.headers.get === 'function' ? (res.headers.get('content-range') || '') : '').split('/')[1]);
      if (page.length < PAGE || (total && rows.length >= total)) break;
      offset += PAGE;
    }
    return rows;
  }

  async function load() {
    try {
      if (syncStatusEl && state.statsRows.length === 0) {
        syncStatusEl.innerHTML = '<span style="color:var(--gold-text)">⚡ Connecting to Supabase Tokyo...</span>';
      }
      const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' };
      const statsRows = await fetchAllRows(
        `${REST}?select=id,symbol,market,direction,score,trigger_name,context_regime,entry,stop,target,risk_pct,status,outcome_a,outcome_b,outcome_c,exit_reason,tp1_hit,tp2_hit,tp3_hit,tp1_time_min,tp2_time_min,tp3_time_min,duration_min,bar_time,resolved_bar_time,resolved_at,created_at,wm_filter,path&order=bar_time.asc`,
        headers
      );
      state.statsRows = statsRows;

      // Render immediately with historical records so UI is instant
      recalculateAndRender();

      if (syncStatusEl) {
        syncStatusEl.innerHTML = `<span style="color:var(--green-text);font-weight:600;">● Live</span> <span style="color:var(--text3);">(${statsRows.length.toLocaleString()} signals synced &middot; 60s realtime poll)</span>`;
      }

      // Fetch live marks in background so external API latency never blocks dashboard rendering
      fetchMarkPrices(state.statsRows).then(marks => {
        if (marks && Object.keys(marks).length) {
          state.marks = marks;
          recalculateAndRender();
        }
      }).catch(e => console.warn('[PortfolioPage] mark price fetch skipped', e.message));

    } catch (e) {
      console.error('[PortfolioPage] load error', e);
      if (syncStatusEl) {
        syncStatusEl.innerHTML = `<span style="color:var(--red-text)">⚠️ Sync error: ${esc(e.message)}</span>`;
      }
    }
  }

  // Initialize with empty stub so dashboard never crashes while loading
  recalculateAndRender();
  load();
  setInterval(load, 60000);
})();

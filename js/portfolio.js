/* ==========================================================================
   Wicktor — Prop Trading Multi-Account Portfolio Simulation Engine
   Supports Plan A, Plan B, and Plan C execution:

   Funded Account Specifications (No Phase 1 Limit - Continuous Trading):
   - Starting Capital: 10,000 USDT per account
   - Daily Drawdown Limit: 4% ($400 max closed loss), calculated when a trade closes.
     Clock/counter resets strictly every Midnight UTC (00:00:00 UTC).
   - Max Drawdown Limit: 8% ($800 max loss / $9,200 balance floor).
     Updated every Midnight UTC based on completed daily closing capital (not floating loss).
   - Trade Execution Plans:
     * Plan A: Move SL to BE at TP1 (+1R); take 100% at TP2 (+2R).
     * Plan B: Fixed TP at TP3 (+3R); fixed SL at initial stop (-1R). No BE move.
     * Plan C: Scale out 1/3 at TP1 (+1R) + BE stop, dynamic 0.5R trailing stop,
       1/3 at TP2 with TP1 floor, 1/3 at TP3 (+3R), 4h max horizon.
   - Capacity: Controlled concurrent slots (e.g. 5 positions max).
   - Filtering: Top-tier score priority (highest composite score first).
   - Friction: Bybit Perps taker fees (0.055% open + 0.055% close = 0.11% notional).
   ========================================================================== */

(function(exports) {
  'use strict';

  const DEFAULT_OPTIONS = {
    startingCapital: 10000,
    plan: 'C',                 // 'A', 'B', or 'C'
    wmFilter: false,           // boolean: require Wicktor Momentum Filter
    dailyDdLimitPct: 0.04,     // 4% daily closed loss limit
    overallDdLimitPct: 0.08,   // 8% total account limit evaluated at midnight UTC
    maxConcurrentSlots: 5,     // 5 positions max
    riskPctPerTrade: 0.01,     // 1% risk ($100 on $10k)
    minScore: 85,              // top signals priority filter
    feeRate: 0.0011,           // 0.11% Bybit taker round-trip
    leverage: 5,               // 5x isolated margin
    liveMarks: {}              // realtime Bybit ticker prices
  };

  function getUtcDay(timestampMs) {
    if (!timestampMs) return '';
    return new Date(timestampMs).toISOString().slice(0, 10);
  }

  function buildEmptySimulationResult(opts) {
    const startingCapital = Number(opts.startingCapital) || 10000;
    const dailyLimit = Number(opts.dailyDdLimitPct) || 0.04;
    const overallLimit = Number(opts.overallDdLimitPct) || 0.08;
    const maxSlots = Number(opts.maxConcurrentSlots) || 5;
    const plan = (opts.plan || 'C').toUpperCase();
    const todayStr = getUtcDay(Date.now());
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const monthName = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

    return {
      plan,
      wmFilter: !!opts.wmFilter,
      summary: {
        startingCapital,
        currentBalance: startingCapital,
        currentEquity: startingCapital,
        netProfit: 0,
        netRoiPct: 0,
        totalTrades: 0,
        activeTradesCount: 0,
        maxSlots,
        wins: 0,
        losses: 0,
        winRatePct: 0,
        profitFactor: 1.0,
        totalFeesPaid: 0,
        maxDailyDdEncounteredPct: 0,
        maxOverallDdEncounteredPct: 0,
        dailyLimitPct: dailyLimit * 100,
        overallLimitPct: overallLimit * 100,
        dailyBufferDollars: startingCapital * dailyLimit,
        dailyLimitDollars: startingCapital * dailyLimit,
        currentDailyLoss: 0,
        dailyUsedPct: 0,
        overallBufferDollars: startingCapital * overallLimit,
        overallLimitDollars: startingCapital * overallLimit,
        currentOverallLoss: 0,
        overallUsedPct: 0,
        isDailyHalted: false,
        isAccountBreached: false,
        todayNetPnl: 0,
        todayNetPct: 0,
        currentUtcDay: todayStr,
        statusText: 'Funded / Active (No End Target)'
      },
      objectives: {
        dailyDdLevel: startingCapital - startingCapital * dailyLimit,
        dailyDdLeft: startingCapital * dailyLimit,
        dailyUsedPct: 0,
        maxDdLevel: startingCapital * (1 - overallLimit),
        maxDdLeft: startingCapital * overallLimit,
        maxUsedPct: 0,
        growthNetProfit: 0,
        growthRoiPct: 0
      },
      stats: {
        tradingDaysCount: 0,
        minTradingDays: 0,
        mostTradedAsset: '--',
        avgWin: 0,
        avgLoss: 0,
        avgRWin: 0,
        avgRLoss: 0,
        avgRealizedRr: 1.0,
        profitSplit: 80,
        accountPhase: 'Funded Live Account (No End Target)',
        avgTradePnl: 0,
        avgDailyPnl: 0,
        avgWinDay: 0,
        avgLossDay: 0,
        bestTrade: null,
        worstTrade: null,
        maxWinStreak: 0,
        maxLossStreak: 0,
        maxWinDays: 0,
        maxLossDays: 0,
        profitableDaysPct: 0,
        avgTradesPerDay: 0,
        totalVolumeUsdt: 0
      },
      sessions: {
        london: { name: 'London (07:00 - 13:00)', trades: 0, wins: 0, losses: 0, netPnl: 0, winRatePct: 0, pnlPct: 0 },
        newyork: { name: 'New York (13:00 - 22:00)', trades: 0, wins: 0, losses: 0, netPnl: 0, winRatePct: 0, pnlPct: 0 },
        asia: { name: 'Asia (00:00 - 06:00)', trades: 0, wins: 0, losses: 0, netPnl: 0, winRatePct: 0, pnlPct: 0 },
        other: { name: 'Outside / Other', trades: 0, wins: 0, losses: 0, netPnl: 0, winRatePct: 0, pnlPct: 0 }
      },
      weekdayDistribution: dayNames.map(day => ({ day, trades: 0, wins: 0, losses: 0, netPnl: 0 })),
      longShortStats: {
        longsCount: 0,
        longWins: 0,
        longLosses: 0,
        longWinRate: 0,
        longNetPnl: 0,
        shortsCount: 0,
        shortWins: 0,
        shortLosses: 0,
        shortWinRate: 0,
        shortNetPnl: 0
      },
      calendar: {
        currentYear,
        currentMonth: currentMonth + 1,
        monthName,
        calendarDays: [],
        weekTotals: {},
        bestWeek: null,
        worstWeek: null,
        bestMonthNetPnl: 0,
        worstMonthNetPnl: 0,
        winningDaysCount: 0,
        losingDaysCount: 0
      },
      curvePoints: [{ time: Date.now(), balance: startingCapital, netPnl: 0 }],
      activePositions: [],
      closedTrades: [],
      dailyLedger: []
    };
  }

  function simulate(signals, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startingCapital = Number(opts.startingCapital) || 10000;
    const plan = (opts.plan || 'C').toUpperCase();
    const dailyLimit = Number(opts.dailyDdLimitPct) || 0.04;
    const overallLimit = Number(opts.overallDdLimitPct) || 0.08;
    const maxSlots = Number(opts.maxConcurrentSlots) || 5;
    const riskPct = Number(opts.riskPctPerTrade) || 0.01;
    const minScore = Number(opts.minScore) || 85;
    const feeRate = Number(opts.feeRate) || 0.0011;
    const leverage = Number(opts.leverage) || 5;
    const liveMarks = opts.liveMarks || {};

    let capital = startingCapital;
    let peakDailyClosingCapital = startingCapital;
    let maxOverallDdEncountered = 0;
    let maxDailyDdEncountered = 0;
    let accountBreached = false;

    // Daily tracking state
    let currentUtcDay = '';
    let dayStartCapital = startingCapital;
    let dailyHalted = false;

    const activeTrades = new Map(); // id -> trade
    const closedTrades = [];
    const dailyLedger = new Map();  // dateStr -> record

    function getDayRecord(dateStr, cap) {
      if (!dailyLedger.has(dateStr)) {
        dailyLedger.set(dateStr, {
          date: dateStr,
          startCapital: cap,
          endCapital: cap,
          tradesCount: 0,
          wins: 0,
          losses: 0,
          grossPnl: 0,
          fees: 0,
          netPnl: 0,
          maxDailyDd: 0,
          isHalted: false
        });
      }
      return dailyLedger.get(dateStr);
    }

    const requireWm = !!opts.wmFilter;
    const validSignals = (signals || [])
      .filter(s => s && s.bar_time && (s.status === 'resolved' || s.status === 'open'))
      .filter(s => Number(s.score) >= minScore)
      .filter(s => !requireWm || s.wm_filter === true || (s.context_regime && s.context_regime.includes('[WM]')) || (s.trigger_name && s.trigger_name.includes('[WM]')));

    if (!validSignals.length) {
      return buildEmptySimulationResult(opts);
    }

    // Determine event boundaries
    const minTs = Math.min(...validSignals.map(s => s.bar_time));
    const maxTs = Math.max(...validSignals.map(s => s.resolved_bar_time || s.bar_time), Date.now());

    const events = [];

    // Schedule midnights strictly at 00:00:00.000 UTC
    const startDayTs = Math.floor(minTs / 86400000) * 86400000;
    const endDayTs = Math.ceil(maxTs / 86400000) * 86400000;
    for (let ts = startDayTs; ts <= endDayTs; ts += 86400000) {
      events.push({
        type: 'MIDNIGHT',
        time: ts,
        dateStr: getUtcDay(ts),
        priority: 0 // highest priority at timestamp
      });
    }

    // Schedule signal candidates
    for (const s of validSignals) {
      events.push({
        type: 'ENTER_CANDIDATE',
        time: s.bar_time,
        signal: s,
        priority: 2
      });
    }

    // Sort events: chronologically, then priority (MIDNIGHT 0 -> EXIT 1 -> ENTER 2)
    events.sort((a, b) => a.time === b.time ? a.priority - b.priority : a.time - b.time);

    let idx = 0;
    while (idx < events.length) {
      const ev = events[idx];
      const nowTime = ev.time;

      if (ev.type === 'MIDNIGHT') {
        if (currentUtcDay && dailyLedger.has(currentUtcDay)) {
          dailyLedger.get(currentUtcDay).endCapital = capital;
        }

        // Rule 1: Max drawdown is updated every midnight UTC as the final loss of that day is added (not floating loss)
        if (capital > peakDailyClosingCapital) peakDailyClosingCapital = capital;
        const midnightDd = peakDailyClosingCapital > 0 ? (peakDailyClosingCapital - capital) / peakDailyClosingCapital : 0;
        if (midnightDd > maxOverallDdEncountered) maxOverallDdEncountered = midnightDd;

        // Account floor: 8% max loss from starting capital ($9,200 floor)
        if (capital <= startingCapital * (1 - overallLimit)) {
          accountBreached = true;
        }

        currentUtcDay = ev.dateStr;
        dayStartCapital = capital;
        dailyHalted = false; // Rule 1: Daily drawdown clock strictly resets at midnight UTC
        getDayRecord(currentUtcDay, dayStartCapital);
        idx++;
        continue;
      }

      if (ev.type === 'EXIT') {
        const trade = ev.trade;
        activeTrades.delete(trade.id);
        capital += trade.netPnl;

        // Rule 1: Daily drawdown is calculated when a trade closes, not running loss
        const dayLoss = Math.max(0, dayStartCapital - capital);
        const dayDd = dayStartCapital > 0 ? dayLoss / dayStartCapital : 0;
        if (dayDd > maxDailyDdEncountered) maxDailyDdEncountered = dayDd;

        const dayRec = getDayRecord(currentUtcDay, dayStartCapital);
        if (dayDd > dayRec.maxDailyDd) dayRec.maxDailyDd = dayDd;
        if (dayDd >= dailyLimit) {
          dailyHalted = true;
          dayRec.isHalted = true;
        }

        dayRec.tradesCount++;
        if (trade.netPnl > 0) dayRec.wins++;
        else if (trade.netPnl < 0) dayRec.losses++;
        dayRec.grossPnl += trade.grossPnl;
        dayRec.fees += trade.fee;
        dayRec.netPnl += trade.netPnl;
        dayRec.endCapital = capital;

        trade.balanceAfter = capital;
        closedTrades.push(trade);
        idx++;
        continue;
      }

      if (ev.type === 'ENTER_CANDIDATE') {
        // Collect all candidates firing at this exact bar_time
        const batch = [];
        while (idx < events.length && events[idx].type === 'ENTER_CANDIDATE' && events[idx].time === nowTime) {
          batch.push(events[idx].signal);
          idx++;
        }

        if (accountBreached || dailyHalted) continue;

        const openSlots = maxSlots - activeTrades.size;
        if (openSlots <= 0) continue;

        const activeSymbols = new Set(Array.from(activeTrades.values()).map(t => t.symbol));
        // Pick best candidates: not already active in coin, sorted by highest composite score
        const chosen = batch
          .filter(s => !activeSymbols.has(s.symbol))
          .sort((a, b) => Number(b.score) - Number(a.score))
          .slice(0, openSlots);

        for (const sig of chosen) {
          const riskDollar = capital * riskPct;
          const entry = Number(sig.entry);
          const stop = Number(sig.stop);
          const target = Number(sig.target);
          const rawRisk = Math.abs(entry - stop);
          if (!rawRisk) continue;

          const stopPct = rawRisk / entry;
          const notional = riskDollar / stopPct;
          const margin = notional / leverage;
          const fee = notional * feeRate;

          // Determine outcome multiple based on account's execution plan (A, B, or C)
          let outcomeR = null;
          let exitReason = 'resolved';

          if (plan === 'A') {
            outcomeR = sig.outcome_a != null ? Number(sig.outcome_a) : null;
            if (outcomeR != null) {
              if (outcomeR >= 2.0) exitReason = 'TP2 (+2R) Full Win';
              else if (outcomeR === 0) exitReason = 'TP1 Breakeven';
              else if (outcomeR <= -1.0) exitReason = 'Initial SL';
              else exitReason = sig.exit_reason || 'Plan A Exit';
            }
          } else if (plan === 'B') {
            outcomeR = sig.outcome_b != null ? Number(sig.outcome_b) : null;
            if (outcomeR != null) {
              if (outcomeR >= 3.0) exitReason = 'TP3 (+3R) Runner';
              else if (outcomeR <= -1.0) exitReason = 'Initial SL';
              else exitReason = sig.exit_reason || 'Plan B Exit';
            }
          } else { // Plan C
            outcomeR = sig.outcome_c != null ? Number(sig.outcome_c)
              : (sig.outcome_a != null ? Number(sig.outcome_a) : null);
            if (outcomeR != null) {
              if (outcomeR >= 3.0) exitReason = 'TP3 Full Winner';
              else if (outcomeR >= 2.0) exitReason = 'TP2 Winner';
              else if (outcomeR >= 0.33) exitReason = 'Dynamic Trail Hit';
              else if (outcomeR === 0) exitReason = 'TP1 Breakeven';
              else if (outcomeR <= -1.0) exitReason = 'Initial SL';
              else exitReason = sig.exit_reason || 'Plan C Exit';
            }
          }

          if (sig.status === 'resolved' && outcomeR != null) {
            const grossPnl = riskDollar * outcomeR;
            const netPnl = grossPnl - fee;
            const durMin = sig.duration_min != null ? Number(sig.duration_min)
              : (sig.resolved_bar_time && sig.bar_time ? Math.round((sig.resolved_bar_time - sig.bar_time) / 60000) : 240);
            const exitTime = sig.resolved_bar_time || (sig.bar_time + durMin * 60000);

            const trade = {
              id: sig.id,
              symbol: sig.symbol,
              market: sig.market,
              direction: Number(sig.direction),
              score: Number(sig.score),
              trigger_name: sig.trigger_name,
              context_regime: sig.context_regime,
              entry, stop, target,
              bar_time: sig.bar_time,
              exitTime,
              duration_min: durMin,
              status: 'resolved',
              exit_reason: exitReason,
              plan,
              outcome_r: outcomeR,
              outcome_a: sig.outcome_a,
              outcome_b: sig.outcome_b,
              outcome_c: sig.outcome_c,
              riskDollar, notional, margin, fee, grossPnl, netPnl,
              created_at: sig.created_at,
              resolved_at: sig.resolved_at
            };

            activeTrades.set(trade.id, trade);

            // Schedule EXIT event
            const exitEv = { type: 'EXIT', time: exitTime, trade, priority: 1 };
            let ins = idx;
            while (ins < events.length && (events[ins].time < exitTime || (events[ins].time === exitTime && events[ins].priority <= 1))) {
              ins++;
            }
            events.splice(ins, 0, exitEv);
          } else if (sig.status === 'open') {
            // Realtime active open trade
            const durMin = Math.max(0, Math.round((Date.now() - sig.bar_time) / 60000));
            const trade = {
              id: sig.id,
              symbol: sig.symbol,
              market: sig.market,
              direction: Number(sig.direction),
              score: Number(sig.score),
              trigger_name: sig.trigger_name,
              context_regime: sig.context_regime,
              entry, stop, target,
              bar_time: sig.bar_time,
              exitTime: null,
              duration_min: durMin,
              status: 'open',
              exit_reason: 'open',
              plan,
              outcome_r: null,
              outcome_a: null,
              outcome_b: null,
              outcome_c: null,
              riskDollar, notional, margin, fee, grossPnl: 0, netPnl: 0,
              created_at: sig.created_at,
              resolved_at: null
            };
            activeTrades.set(trade.id, trade);
          }
        }
      }
    }

    // Process currently active open positions with live marks
    const activePositions = [];
    let unrealizedGrossSum = 0;
    let unrealizedFeeSum = 0;

    for (const trade of activeTrades.values()) {
      if (trade.status === 'open') {
        const markKey = `${trade.symbol}:${trade.market}`;
        const mark = liveMarks[markKey] || liveMarks[trade.symbol] || trade.entry;
        const risk = Math.abs(trade.entry - trade.stop);
        const unrealizedR = risk ? (trade.direction * (mark - trade.entry)) / risk : 0;
        const unGross = trade.riskDollar * unrealizedR;
        const unFee = trade.notional * feeRate;
        const unNet = unGross - unFee;

        // Trailing stop status based on plan
        const tp1Level = trade.entry + trade.direction * 1.0 * risk;
        const tp2Level = trade.entry + trade.direction * 2.0 * risk;
        const tp3Level = trade.entry + trade.direction * 3.0 * risk;
        const tp1Hit = trade.direction === 1 ? mark >= tp1Level : mark <= tp1Level;
        const tp2Hit = trade.direction === 1 ? mark >= tp2Level : mark <= tp2Level;

        let trailingStatus = 'Initial SL';
        let currentTrailingStop = trade.stop;

        if (plan === 'A') {
          if (tp1Hit) {
            trailingStatus = 'SL @ Breakeven (0R)';
            currentTrailingStop = trade.entry;
          }
        } else if (plan === 'B') {
          trailingStatus = 'Fixed 3R Target';
        } else { // Plan C
          if (tp2Hit) {
            trailingStatus = 'Trail TP1 Ratchet';
            currentTrailingStop = tp1Level;
          } else if (tp1Hit) {
            trailingStatus = 'Trail 0.5R (SL @ BE)';
            currentTrailingStop = trade.entry;
          }
        }

        unrealizedGrossSum += unGross;
        unrealizedFeeSum += unFee;

        activePositions.push({
          ...trade,
          markPrice: mark,
          unrealizedR,
          unrealizedGrossPnl: unGross,
          unrealizedFee: unFee,
          unrealizedNetPnl: unNet,
          currentTrailingStop,
          trailingStatus,
          tp1Level,
          tp2Level,
          tp3Level
        });
      }
    }

    // Closed capital is our realized ledger balance
    const currentEquity = capital + (unrealizedGrossSum - unrealizedFeeSum);
    const netProfit = currentEquity - startingCapital;
    const netRoiPct = (netProfit / startingCapital) * 100;

    const todayStr = getUtcDay(Date.now());
    const todayRec = dailyLedger.get(todayStr) || { startCapital: dayStartCapital };
    const todayStartCap = todayRec.startCapital || dayStartCapital;
    const todayNetPnl = currentEquity - todayStartCap;
    const todayNetPct = todayStartCap > 0 ? (todayNetPnl / todayStartCap) * 100 : 0;

    // Rule 1: Daily Drawdown is calculated when a trade closes (realized closed loss today)
    const todayClosedLoss = Math.max(0, todayStartCap - capital);
    const currentDailyDd = todayStartCap > 0 ? todayClosedLoss / todayStartCap : 0;
    if (currentDailyDd > maxDailyDdEncountered) maxDailyDdEncountered = currentDailyDd;

    const dailyLimitDollars = todayStartCap * dailyLimit;
    const dailyBufferDollars = Math.max(0, dailyLimitDollars - todayClosedLoss);
    const dailyUsedPct = Math.min(100, (todayClosedLoss / dailyLimitDollars) * 100);

    // Rule 1: Max drawdown is updated every midnight UTC on closing capital (not floating loss)
    const overallLimitDollars = startingCapital * overallLimit;
    const currentOverallLoss = Math.max(0, startingCapital - capital);
    const overallBufferDollars = Math.max(0, capital - (startingCapital * (1 - overallLimit)));
    const overallUsedPct = Math.min(100, (currentOverallLoss / overallLimitDollars) * 100);

    // Rule 3: No phase 1 limit or ceiling
    const isDailyHalted = dailyHalted || todayClosedLoss >= dailyLimitDollars;
    const isAccountBreached = accountBreached || capital <= startingCapital * (1 - overallLimit);

    let statusText = 'Funded / Active (No End Target)';
    if (isAccountBreached) {
      statusText = 'Breached (8% DD Floor)';
    } else if (isDailyHalted) {
      statusText = 'Halted (4% Daily Limit)';
    }

    // Wins and Losses metrics
    const wins = closedTrades.filter(t => t.netPnl > 0);
    const losses = closedTrades.filter(t => t.netPnl < 0);
    const grossProfitSum = wins.reduce((s, t) => s + t.grossPnl, 0);
    const grossLossSum = Math.abs(losses.reduce((s, t) => s + t.grossPnl, 0));
    const profitFactor = grossLossSum ? grossProfitSum / grossLossSum : (grossProfitSum ? 99.9 : 1.0);
    const totalFeesPaid = closedTrades.reduce((s, t) => s + t.fee, 0);

    const avgWin = wins.length ? wins.reduce((s, t) => s + t.netPnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.netPnl, 0) / losses.length : 0;
    const bestTrade = closedTrades.length ? closedTrades.reduce((max, t) => t.netPnl > max.netPnl ? t : max, closedTrades[0]) : null;
    const worstTrade = closedTrades.length ? closedTrades.reduce((min, t) => t.netPnl < min.netPnl ? t : min, closedTrades[0]) : null;

    // Realized R:R metrics
    const avgRWin = wins.length ? wins.reduce((s, t) => s + Number(t.outcome_r || 0), 0) / wins.length : 0;
    const avgRLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + Number(t.outcome_r || 0), 0)) / losses.length : 1;
    const avgRealizedRr = avgRLoss ? (avgRWin / avgRLoss) : avgRWin;

    // Asset frequency
    const assetCounts = {};
    for (const t of closedTrades) {
      const sym = t.symbol.replace(/USDT$/, '');
      assetCounts[sym] = (assetCounts[sym] || 0) + 1;
    }
    let mostTradedAsset = '--';
    let maxAssetCount = 0;
    for (const [sym, count] of Object.entries(assetCounts)) {
      if (count > maxAssetCount) {
        maxAssetCount = count;
        mostTradedAsset = `${sym} (${count})`;
      }
    }

    // Sessions breakdown (UTC Hours)
    const sessions = {
      london: { name: 'London (07:00 - 13:00)', trades: 0, wins: 0, losses: 0, netPnl: 0 },
      newyork: { name: 'New York (13:00 - 22:00)', trades: 0, wins: 0, losses: 0, netPnl: 0 },
      asia: { name: 'Asia (00:00 - 06:00)', trades: 0, wins: 0, losses: 0, netPnl: 0 },
      other: { name: 'Outside / Other', trades: 0, wins: 0, losses: 0, netPnl: 0 }
    };

    for (const t of closedTrades) {
      const h = new Date(t.bar_time).getUTCHours();
      let sess = sessions.other;
      if (h >= 7 && h < 13) sess = sessions.london;
      else if (h >= 13 && h < 22) sess = sessions.newyork;
      else if (h >= 0 && h < 6) sess = sessions.asia;

      sess.trades++;
      if (t.netPnl > 0) sess.wins++;
      else if (t.netPnl < 0) sess.losses++;
      sess.netPnl += t.netPnl;
    }

    for (const k of Object.keys(sessions)) {
      const s = sessions[k];
      s.winRatePct = s.trades ? (s.wins / s.trades) * 100 : 0;
      s.pnlPct = (s.netPnl / startingCapital) * 100;
    }

    // Weekday distribution (Monday to Sunday)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekdayMap = {};
    for (let d = 0; d < 7; d++) {
      weekdayMap[d] = { day: dayNames[d], trades: 0, wins: 0, losses: 0, netPnl: 0 };
    }
    for (const t of closedTrades) {
      const d = new Date(t.bar_time).getUTCDay();
      weekdayMap[d].trades++;
      if (t.netPnl > 0) weekdayMap[d].wins++;
      else if (t.netPnl < 0) weekdayMap[d].losses++;
      weekdayMap[d].netPnl += t.netPnl;
    }
    // Reorder Mon (1) to Sun (0)
    const weekdayDistribution = [1, 2, 3, 4, 5, 6, 0].map(d => weekdayMap[d]);

    // Streaks
    let curWinStreak = 0, curLossStreak = 0;
    let maxWinStreak = 0, maxLossStreak = 0;
    for (const t of closedTrades) {
      if (t.netPnl > 0) {
        curWinStreak++;
        curLossStreak = 0;
        if (curWinStreak > maxWinStreak) maxWinStreak = curWinStreak;
      } else if (t.netPnl < 0) {
        curLossStreak++;
        curWinStreak = 0;
        if (curLossStreak > maxLossStreak) maxLossStreak = curLossStreak;
      }
    }

    // Daily Streaks & Calendar metrics
    const dailyList = Array.from(dailyLedger.values());
    const tradingDays = dailyList.filter(d => d.tradesCount > 0);
    const winningDays = tradingDays.filter(d => d.netPnl > 0);
    const losingDays = tradingDays.filter(d => d.netPnl < 0);

    let curWinDays = 0, curLossDays = 0;
    let maxWinDays = 0, maxLossDays = 0;
    for (const d of tradingDays.slice().reverse()) {
      if (d.netPnl > 0) {
        curWinDays++;
        curLossDays = 0;
        if (curWinDays > maxWinDays) maxWinDays = curWinDays;
      } else if (d.netPnl < 0) {
        curLossDays++;
        curWinDays = 0;
        if (curLossDays > maxLossDays) maxLossDays = curLossDays;
      }
    }

    // Long vs Short statistics
    const longs = closedTrades.filter(t => t.direction === 1);
    const shorts = closedTrades.filter(t => t.direction === -1);
    const longWins = longs.filter(t => t.netPnl > 0).length;
    const shortWins = shorts.filter(t => t.netPnl > 0).length;

    // Cumulative points curve for balance chart
    let runningCap = startingCapital;
    const curvePoints = [{ time: minTs, balance: startingCapital, netPnl: 0 }];
    for (const t of closedTrades) {
      runningCap += t.netPnl;
      curvePoints.push({
        time: t.exitTime || t.bar_time,
        dateStr: getUtcDay(t.exitTime || t.bar_time),
        balance: runningCap,
        netPnl: runningCap - startingCapital
      });
    }

    // Calendar month/week breakdown
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const monthName = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

    const totalDaysInMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate();
    const calendarDays = [];
    const weekTotals = { 1: { netPnl: 0, trades: 0 }, 2: { netPnl: 0, trades: 0 }, 3: { netPnl: 0, trades: 0 }, 4: { netPnl: 0, trades: 0 }, 5: { netPnl: 0, trades: 0 } };

    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayDate = new Date(Date.UTC(currentYear, currentMonth, day));
      const dayOfWeek = (dayDate.getUTCDay() + 6) % 7; // 0 = Mon, 6 = Sun
      const weekNum = Math.min(5, Math.ceil(day / 7));

      const rec = dailyLedger.get(dayStr);
      const dayNetPnl = rec ? rec.netPnl : 0;
      const dayTrades = rec ? rec.tradesCount : 0;
      const dayWins = rec ? rec.wins : 0;
      const dayLosses = rec ? rec.losses : 0;

      if (rec) {
        weekTotals[weekNum].netPnl += dayNetPnl;
        weekTotals[weekNum].trades += dayTrades;
      }

      calendarDays.push({
        day,
        dayStr,
        dayOfWeek,
        weekNum,
        netPnl: dayNetPnl,
        trades: dayTrades,
        wins: dayWins,
        losses: dayLosses,
        isToday: dayStr === todayStr,
        hasData: rec != null && dayTrades > 0
      });
    }

    const weekEntries = Object.entries(weekTotals).filter(([_, w]) => w.trades > 0);
    const bestWeek = weekEntries.length ? weekEntries.reduce((max, [k, v]) => v.netPnl > max.netPnl ? { week: k, ...v } : max, { week: weekEntries[0][0], ...weekEntries[0][1] }) : null;
    const worstWeek = weekEntries.length ? weekEntries.reduce((min, [k, v]) => v.netPnl < min.netPnl ? { week: k, ...v } : min, { week: weekEntries[0][0], ...weekEntries[0][1] }) : null;

    return {
      plan,
      summary: {
        startingCapital,
        currentBalance: capital,
        currentEquity,
        netProfit,
        netRoiPct,
        totalTrades: closedTrades.length,
        activeTradesCount: activePositions.length,
        maxSlots,
        wins: wins.length,
        losses: losses.length,
        winRatePct: closedTrades.length ? (wins.length / closedTrades.length) * 100 : 0,
        profitFactor,
        totalFeesPaid,
        maxDailyDdEncounteredPct: maxDailyDdEncountered * 100,
        maxOverallDdEncounteredPct: maxOverallDdEncountered * 100,
        dailyLimitPct: dailyLimit * 100,
        overallLimitPct: overallLimit * 100,
        dailyBufferDollars,
        dailyLimitDollars,
        currentDailyLoss: todayClosedLoss,
        dailyUsedPct,
        overallBufferDollars,
        overallLimitDollars,
        currentOverallLoss,
        overallUsedPct,
        isDailyHalted,
        isAccountBreached,
        todayNetPnl,
        todayNetPct,
        currentUtcDay: todayStr,
        statusText
      },
      objectives: {
        dailyDdLevel: todayStartCap - dailyLimitDollars,
        dailyDdLeft: dailyBufferDollars,
        dailyUsedPct,
        maxDdLevel: startingCapital * (1 - overallLimit),
        maxDdLeft: overallBufferDollars,
        maxUsedPct: overallUsedPct,
        growthNetProfit: netProfit,
        growthRoiPct: netRoiPct
      },
      stats: {
        tradingDaysCount: tradingDays.length,
        minTradingDays: 0,
        mostTradedAsset,
        avgWin,
        avgLoss,
        avgRWin,
        avgRLoss,
        avgRealizedRr,
        profitSplit: 80,
        accountPhase: 'Funded Live Account (No End Target)',
        avgTradePnl: closedTrades.length ? netProfit / closedTrades.length : 0,
        avgDailyPnl: tradingDays.length ? netProfit / tradingDays.length : 0,
        avgWinDay: winningDays.length ? winningDays.reduce((s, d) => s + d.netPnl, 0) / winningDays.length : 0,
        avgLossDay: losingDays.length ? losingDays.reduce((s, d) => s + d.netPnl, 0) / losingDays.length : 0,
        bestTrade,
        worstTrade,
        maxWinStreak,
        maxLossStreak,
        maxWinDays,
        maxLossDays,
        profitableDaysPct: tradingDays.length ? (winningDays.length / tradingDays.length) * 100 : 0,
        avgTradesPerDay: tradingDays.length ? (closedTrades.length / tradingDays.length) : 0,
        totalVolumeUsdt: closedTrades.reduce((s, t) => s + (t.notional || 0), 0)
      },
      sessions,
      weekdayDistribution,
      longShortStats: {
        longsCount: longs.length,
        longWins,
        longLosses: longs.length - longWins,
        longWinRate: longs.length ? (longWins / longs.length) * 100 : 0,
        longNetPnl: longs.reduce((s, t) => s + t.netPnl, 0),
        shortsCount: shorts.length,
        shortWins,
        shortLosses: shorts.length - shortWins,
        shortWinRate: shorts.length ? (shortWins / shorts.length) * 100 : 0,
        shortNetPnl: shorts.reduce((s, t) => s + t.netPnl, 0)
      },
      calendar: {
        currentYear,
        currentMonth: currentMonth + 1,
        monthName,
        calendarDays,
        weekTotals,
        bestWeek,
        worstWeek,
        bestMonthNetPnl: netProfit,
        worstMonthNetPnl: netProfit,
        winningDaysCount: winningDays.length,
        losingDaysCount: losingDays.length
      },
      curvePoints,
      activePositions,
      closedTrades: closedTrades.reverse(),
      dailyLedger: dailyList.reverse()
    };
  }

  function simulateMulti(signals, options = {}) {
    return {
      planA: simulate(signals, { ...options, plan: 'A', wmFilter: false }),
      planB: simulate(signals, { ...options, plan: 'B', wmFilter: false }),
      planC: simulate(signals, { ...options, plan: 'C', wmFilter: false }),
      planA_wm: simulate(signals, { ...options, plan: 'A', wmFilter: true }),
      planB_wm: simulate(signals, { ...options, plan: 'B', wmFilter: true }),
      planC_wm: simulate(signals, { ...options, plan: 'C', wmFilter: true })
    };
  }

  exports.PortfolioSimulator = {
    DEFAULT_OPTIONS,
    simulate,
    simulateMulti
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports.PortfolioSimulator;
  }
})(typeof window !== 'undefined' ? window : global);

/* ==========================================================================
   Wicktor — Prop Trading Portfolio Simulation Engine (Plan C)

   Simulates a realistic $10,000 USDT prop-firm / personal trading account:
   - Starting Capital: 10,000 USDT
   - Daily Drawdown Limit: 4% ($400), strictly resetting every midnight UTC (00:00:00 UTC)
   - Max Overall Drawdown Limit: 8% ($800)
   - Trade Execution: Plan C (1/3 at TP1 + BE stop, 0.5R dynamic trailing stop,
     1/3 at TP2 with TP1 floor, 1/3 at TP3, 4h max horizon)
   - Capacity: Controlled concurrent slots (e.g. 5 positions max)
   - Filtering: Top-tier score priority (highest composite score first)
   - Friction: Realistic Bybit Perps taker fees (0.055% open + 0.055% close = 0.11% notional)
   ========================================================================== */

(function(exports) {
  'use strict';

  const DEFAULT_OPTIONS = {
    startingCapital: 10000,
    dailyDdLimitPct: 0.04,     // 4% daily limit
    overallDdLimitPct: 0.08,   // 8% total account limit
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

  function simulate(signals, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startingCapital = Number(opts.startingCapital) || 10000;
    const dailyLimit = Number(opts.dailyDdLimitPct) || 0.04;
    const overallLimit = Number(opts.overallDdLimitPct) || 0.08;
    const maxSlots = Number(opts.maxConcurrentSlots) || 5;
    const riskPct = Number(opts.riskPctPerTrade) || 0.01;
    const minScore = Number(opts.minScore) || 85;
    const feeRate = Number(opts.feeRate) || 0.0011;
    const leverage = Number(opts.leverage) || 5;
    const liveMarks = opts.liveMarks || {};

    let capital = startingCapital;
    let peakCapital = startingCapital;
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

    const validSignals = (signals || [])
      .filter(s => s && s.bar_time && (s.status === 'resolved' || s.status === 'open'))
      .filter(s => Number(s.score) >= minScore);

    if (!validSignals.length) {
      const today = getUtcDay(Date.now());
      return {
        summary: {
          startingCapital,
          currentBalance: capital,
          currentEquity: capital,
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
          overallBufferDollars: startingCapital * overallLimit,
          isDailyHalted: false,
          isAccountBreached: false,
          todayNetPnl: 0,
          todayNetPct: 0,
          currentUtcDay: today
        },
        activePositions: [],
        closedTrades: [],
        dailyLedger: []
      };
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
        currentUtcDay = ev.dateStr;
        dayStartCapital = capital;
        dailyHalted = false;
        getDayRecord(currentUtcDay, dayStartCapital);
        idx++;
        continue;
      }

      if (ev.type === 'EXIT') {
        const trade = ev.trade;
        activeTrades.delete(trade.id);
        capital += trade.netPnl;

        if (capital > peakCapital) peakCapital = capital;
        const totalDd = (peakCapital - capital) / peakCapital;
        if (totalDd > maxOverallDdEncountered) maxOverallDdEncountered = totalDd;
        if ((startingCapital - capital) / startingCapital >= overallLimit) {
          accountBreached = true;
        }

        const dayLoss = Math.max(0, dayStartCapital - capital);
        const dayDd = dayLoss / dayStartCapital;
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

          if (sig.status === 'resolved' && sig.outcome_c != null) {
            const outcomeR = Number(sig.outcome_c);
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
              exit_reason: sig.exit_reason || 'resolved',
              outcome_c: outcomeR,
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

        // Plan C dynamic trailing stop status
        const tp1Level = trade.entry + trade.direction * 1.0 * risk;
        const tp2Level = trade.entry + trade.direction * 2.0 * risk;
        const tp1Hit = trade.direction === 1 ? mark >= tp1Level : mark <= tp1Level;
        const tp2Hit = trade.direction === 1 ? mark >= tp2Level : mark <= tp2Level;

        let trailingStatus = 'Initial SL';
        let currentTrailingStop = trade.stop;
        if (tp2Hit) {
          trailingStatus = 'Trail TP1 Ratchet';
          currentTrailingStop = tp1Level;
        } else if (tp1Hit) {
          trailingStatus = 'Trail 0.5R (SL @ BE)';
          currentTrailingStop = trade.entry;
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
          tp2Level
        });
      }
    }

    const currentEquity = capital + (unrealizedGrossSum - unrealizedFeeSum);
    const netProfit = currentEquity - startingCapital;
    const netRoiPct = (netProfit / startingCapital) * 100;

    const todayStr = getUtcDay(Date.now());
    const todayRec = dailyLedger.get(todayStr) || { startCapital: dayStartCapital };
    const todayStartCap = todayRec.startCapital || dayStartCapital;
    const todayNetPnl = currentEquity - todayStartCap;
    const todayNetPct = (todayNetPnl / todayStartCap) * 100;

    const currentDailyDd = Math.max(0, todayStartCap - currentEquity) / todayStartCap;
    if (currentDailyDd > maxDailyDdEncountered) maxDailyDdEncountered = currentDailyDd;

    const dailyBufferDollars = Math.max(0, (todayStartCap * dailyLimit) - Math.max(0, todayStartCap - currentEquity));
    const overallBufferDollars = Math.max(0, (startingCapital * overallLimit) - Math.max(0, peakCapital - currentEquity));

    const wins = closedTrades.filter(t => t.netPnl > 0).length;
    const losses = closedTrades.filter(t => t.netPnl < 0).length;
    const grossProfitSum = closedTrades.filter(t => t.grossPnl > 0).reduce((s, t) => s + t.grossPnl, 0);
    const grossLossSum = Math.abs(closedTrades.filter(t => t.grossPnl < 0).reduce((s, t) => s + t.grossPnl, 0));
    const profitFactor = grossLossSum ? grossProfitSum / grossLossSum : (grossProfitSum ? 99.9 : 1.0);
    const totalFeesPaid = closedTrades.reduce((s, t) => s + t.fee, 0);

    return {
      summary: {
        startingCapital,
        currentBalance: capital,
        currentEquity,
        netProfit,
        netRoiPct,
        totalTrades: closedTrades.length,
        activeTradesCount: activePositions.length,
        maxSlots,
        wins,
        losses,
        winRatePct: closedTrades.length ? (wins / closedTrades.length) * 100 : 0,
        profitFactor,
        totalFeesPaid,
        maxDailyDdEncounteredPct: maxDailyDdEncountered * 100,
        maxOverallDdEncounteredPct: maxOverallDdEncountered * 100,
        dailyLimitPct: dailyLimit * 100,
        overallLimitPct: overallLimit * 100,
        dailyBufferDollars,
        overallBufferDollars,
        isDailyHalted: dailyHalted || currentDailyDd >= dailyLimit,
        isAccountBreached: accountBreached || (startingCapital - currentEquity) / startingCapital >= overallLimit,
        todayNetPnl,
        todayNetPct,
        currentUtcDay: todayStr
      },
      activePositions,
      closedTrades: closedTrades.reverse(),
      dailyLedger: Array.from(dailyLedger.values()).reverse()
    };
  }

  exports.PortfolioSimulator = {
    DEFAULT_OPTIONS,
    simulate
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports.PortfolioSimulator;
  }
})(typeof window !== 'undefined' ? window : global);

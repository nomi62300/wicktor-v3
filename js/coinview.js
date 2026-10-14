/* ==========================================================================
   Wicktor — coin view builder

   Turns a Scoring.evaluate() result plus its raw inputs into the exact
   object the card grid and detail modal render from. Nothing here fetches
   or scores; it is the display contract, in one place.

   WHY IT IS ITS OWN FILE. The scan moved server-side: the Edge Function
   computes the whole universe every 5 minutes and stores a snapshot, and
   browsers just fetch it. That means the display object is now built on
   the server, in Deno, while every field it produces is consumed in the
   browser. Re-implementing it in TypeScript inside the function would have
   created exactly the drift this codebase keeps refusing to accept
   elsewhere (indicators/scoring/signals are all imported by both sides for
   the same reason). One copy, imported by both.

   DELIBERATELY OMITS tfSnapshots. Nothing in js/render.js or js/app.js
   reads it — verified by grepping every `coin.` access across both — and
   it is by far the largest part of an evaluate() result (three full
   indicator snapshots per coin). Dropping it is the difference between a
   snapshot that is a few hundred KB and one that is several MB per scan.

   Three fields are NOT set here because they are per-browser, not
   per-market: `watchlisted`, `discoveredAgo` and `newsMeta`. The client
   layers those on after fetching a snapshot.
   ========================================================================== */

const CoinView = (() => {

  // Card's Active TF row (4H/1H/15M/5M): displays the true structural trend
  // derived from Williams Alligator lineOrder for each timeframe, along with
  // the timeframe's price % change compared to its previous closed candle.
  function tfChipData(label, candles, snap = null) {
    if (!candles || candles.length < 2) return { label, trend: 'flat', pct: null };
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // Timeframe bar % change: compare current price against the previous closed candle on this timeframe
    let pct = 0;
    if (prev && prev.c) {
      pct = ((last.c - prev.c) / prev.c) * 100;
    } else if (last && last.o) {
      pct = ((last.c - last.o) / last.o) * 100;
    }

    // Trend derived from Williams Alligator lineOrder:
    // 1 = Bullish (Lips > Teeth > Jaw) -> 'up'
    // -1 = Bearish (Lips < Teeth < Jaw) -> 'down'
    let trend = 'flat';
    if (snap) {
      if (snap.lineOrder === 1) trend = 'up';
      else if (snap.lineOrder === -1) trend = 'down';
      else if (snap.ema9 != null && snap.ema21 != null && snap.ema9 !== snap.ema21) {
        trend = snap.ema9 > snap.ema21 ? 'up' : 'down';
      } else if (snap.alignment !== 0) {
        trend = snap.alignment === 1 ? 'up' : 'down';
      }
    }

    // Fallback if snap was not provided or neutral
    if (trend === 'flat') {
      trend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    }

    return { label, trend, pct };
  }

  function classifyVolatility(h1candles) {
    if (!h1candles) return 'Low';
    const last20 = h1candles.slice(-20);
    if (last20.length < 5) return 'Low';
    const ranges = last20.map(c => (c.h - c.l) / c.c);
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    if (avgRange > 0.05) return 'Extreme';
    if (avgRange > 0.03) return 'High';
    if (avgRange > 0.015) return 'Moderate';
    return 'Low';
  }

  function formatPrice(n) {
    if (n == null || isNaN(n)) return '--';
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(4);
  }

  // Byte-identical to Api.formatMcap(), including the em-dash for null and
  // the 1-decimal B/M steps. Duplicated rather than imported because the
  // Edge Function does its own fetching and does not load js/api.js at all
  // — but the OUTPUT must match, or every card's MCap line changes format
  // the moment the snapshot starts feeding it. Checked against the
  // original when this was written.
  function formatMcap(n) {
    if (n == null) return '—';
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    return String(Math.round(n));
  }

  /**
   * @param result   Scoring.evaluate() output
   * @param base     { symbol, price, isStock }
   * @param candles  { h4, h1, m15, m5 } — h4 only feeds the 4H chip
   * @param extras   { market, mcapRaw, sector }
   */
  function build(result, base, candles, extras) {
    if (!result || !base) return null;
    const market = extras && extras.market;
    const priceNum = base.price;
    const displaySymbol = String(base.symbol).replace(/USDT$/, '');
    const mcapRaw = extras ? extras.mcapRaw : null;

    const tradeDir = result.setupDirection || result.bias || 1;
    const tfSnaps = result.tfSnapshots || [];

    // Analyze 4H candles with Indicators if available to obtain its true Alligator & EMA regime
    let snap4h = null;
    if (typeof Indicators !== 'undefined' && Indicators.analyzeTimeframe && candles && candles.h4 && candles.h4.length >= 20) {
      try { snap4h = Indicators.analyzeTimeframe(candles.h4); } catch {}
    }

    return {
      symbol: displaySymbol,
      rawSymbol: base.symbol,
      market,
      sector: (extras && extras.sector) || (base.isStock ? 'Tokenized Stock' : 'Crypto'),
      price: formatPrice(priceNum),
      priceRaw: priceNum,
      side: tradeDir === 1 ? (market === 'PERP' ? 'Long' : 'Buy')
                           : (market === 'PERP' ? 'Short' : 'Sell'),
      mcap: formatMcap(mcapRaw),
      mcapRaw: mcapRaw == null ? null : mcapRaw,
      volatility: classifyVolatility(candles && candles.h1),
      // Always null today — kept so the field exists rather than being
      // undefined at every read site (render.js branches on it).
      unlock: null,
      tfChips: [
        tfChipData('4H', candles && candles.h4, snap4h),
        tfChipData('1H', candles && candles.h1, tfSnaps[0]),
        tfChipData('15M', candles && candles.m15, tfSnaps[1]),
        tfChipData('5M', candles && candles.m5, tfSnaps[2])
      ],
      resistance: formatPrice(result.tfSnapshots[0].resistance),
      support: formatPrice(result.tfSnapshots[0].support),
      resistanceSloped: result.tfSnapshots[0].resistanceSloped,
      supportSloped: result.tfSnapshots[0].supportSloped,

      // --- straight from evaluate(), minus tfSnapshots -------------------
      score: result.score,
      bias: result.bias,
      alignCount: result.alignCount,
      ceiling: result.ceiling,
      direction: result.direction,
      regime: result.regime,
      continuation: result.continuation,
      exhaustion: result.exhaustion,
      reversal: result.reversal,
      setupDirection: result.setupDirection,
      riskReward: result.riskReward,
      crossingLipsWarning: result.crossingLipsWarning,
      rsiByTf: result.rsiByTf,
      divergenceOverall: result.divergenceOverall
    };
  }

  return { build, tfChipData, classifyVolatility, formatPrice, formatMcap };
})();

if (typeof module !== 'undefined') module.exports = CoinView;
// See the matching note in js/indicators.js — Deno gives every ES module
// its own scope, so the Edge Function relies on this bridge.
if (typeof globalThis !== 'undefined') globalThis.CoinView = CoinView;

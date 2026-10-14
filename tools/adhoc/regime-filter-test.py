#!/usr/bin/env python3
"""Can BTC/ETH tell us, AT DECISION TIME, whether moves will sustain?

Not direction — that was already tested and failed (BTC-aligned trades
sign-flipped across slices and made the losing slice worse). This asks
whether the market is TRENDING vs CHOPPING, which is the actual variable
separating the good periods from the bad.

Three principled measures, all rolling and all computed ONLY from bars
closed strictly before each signal:

  variance ratio  VR(q) = Var(q-bar returns) / (q * Var(1-bar returns)).
                  >1 means moves persist, <1 means they mean-revert. This
                  is the textbook test for exactly this question.
  autocorr(1)     does one bar's return predict the next's sign.
  realised vol    stdev of 1-bar returns, as a control — earlier eyeballing
                  suggested volatility alone does NOT separate the slices,
                  so it is included to confirm or refute that properly.

THE BAR TO CLEAR: the filter must turn the LOSING slice (falling 1st
half, where the trail scored -0.11 to -0.15) non-negative. A filter that
only improves the already-winning slices is not a regime filter, it is
just more exposure to trend — which is what the direction filter turned
out to be.
"""
import json, math, statistics, urllib.request, bisect

TAKER = 0.11


def fetch_1h(sym, start, end):
    out, cur = {}, end
    for _ in range(30):
        u = (f"https://api.bybit.com/v5/market/kline?category=linear&symbol={sym}"
             f"&interval=60&start={start}&end={cur}&limit=1000")
        r = json.loads(urllib.request.urlopen(u, timeout=25).read())["result"]["list"]
        if not r:
            break
        for x in r:
            out[int(x[0])] = float(x[4])
        old = min(int(x[0]) for x in r)
        if len(r) < 1000 or old <= start:
            break
        cur = old - 3600000
    return sorted(out.items())


D = [p for p in json.load(open("./r_paths_long.json")) if len(p["bars"]) >= 145]
U = json.load(open("./uptrend_signals.json"))
ALL = D + U
lo = min(p["bar_time"] for p in ALL) - 40 * 86400000
hi = max(p["bar_time"] for p in ALL) + 86400000

series = {s: fetch_1h(s, lo, hi) for s in ("BTCUSDT", "ETHUSDT")}
TS = {s: [t for t, _ in v] for s, v in series.items()}
PX = {s: [c for _, c in v] for s, v in series.items()}


def window(sym, T, n):
    """Closes of the n 1h bars closed strictly before T."""
    i = bisect.bisect_left(TS[sym], T) - 1
    if i - n < 0:
        return None
    return PX[sym][i - n + 1:i + 1]


def measures(T, n=48, q=4):
    out = {}
    for sym in ("BTCUSDT", "ETHUSDT"):
        w = window(sym, T, n + 1)
        if not w or len(w) < n + 1:
            return None
        r = [math.log(w[i + 1] / w[i]) for i in range(len(w) - 1)]
        if len(r) < q * 4:
            return None
        v1 = statistics.pvariance(r)
        if v1 <= 0:
            return None
        agg = [sum(r[i:i + q]) for i in range(0, len(r) - q + 1, q)]
        vq = statistics.pvariance(agg) if len(agg) > 2 else None
        vr = (vq / (q * v1)) if vq else None
        m = statistics.fmean(r)
        num = sum((r[i] - m) * (r[i + 1] - m) for i in range(len(r) - 1))
        den = sum((x - m) ** 2 for x in r)
        ac = num / den if den else None
        out[sym] = {"vr": vr, "ac": ac, "vol": statistics.pstdev(r) * 100}
    return out


def trail(p, after=0.6, dist=0.3, hold=144):
    bars = p["bars"][:hold + 1]
    stop, rem, real, mx, tr = -1.0, 1.0, 0.0, 0.0, False
    for fav, adv, close in bars:
        if tr or mx >= after:
            tr = True
            stop = max(stop, mx - dist)
        if -adv <= stop:
            real += rem * stop
            rem = 0.0
            break
        if fav > mx:
            mx = fav
    if rem > 1e-9:
        real += rem * bars[-1][2]
    return real - TAKER / p["riskPct"]


for p in ALL:
    p["_m"] = measures(p["bar_time"])
    p["_r"] = trail(p)

ok = [p for p in ALL if p["_m"]]
print(f"{len(ok)}/{len(ALL)} signals have a full regime window\n")

D.sort(key=lambda p: p["bar_time"])
mid = D[len(D) // 2]["bar_time"]
SL = [("FALLING 1st half (THE LOSING SLICE)", [p for p in ok if p in D and p["bar_time"] < mid]),
      ("FALLING 2nd half", [p for p in ok if p in D and p["bar_time"] >= mid]),
      ("RISING sample", [p for p in ok if p in U])]


def ci(v):
    m = statistics.fmean(v)
    se = statistics.stdev(v) / math.sqrt(len(v)) if len(v) > 1 else 0
    return m, m - 1.96 * se, m + 1.96 * se


def show(lab, v, ind="    "):
    if len(v) < 15:
        print(f"{ind}{lab:<34} n={len(v)} (too few)")
        return None
    m, l, h = ci(v)
    star = "*" if (l > 0 or h < 0) else " "
    print(f"{ind}{lab:<34} n={len(v):<5} {m:+.4f}{star} CI[{l:+.4f},{h:+.4f}]")
    return m


for key, label in [("vr", "VARIANCE RATIO (>1 = moves persist)"),
                   ("ac", "AUTOCORRELATION lag-1"),
                   ("vol", "REALISED VOL (control)")]:
    vals = sorted(p["_m"]["BTCUSDT"][key] for p in ok if p["_m"]["BTCUSDT"][key] is not None)
    if not vals:
        continue
    med = vals[len(vals) // 2]
    print("=" * 84)
    print(f"{label}   BTC median = {med:.4f}")
    print("=" * 84)
    hi_g = [p for p in ok if p["_m"]["BTCUSDT"][key] is not None and p["_m"]["BTCUSDT"][key] >= med]
    lo_g = [p for p in ok if p["_m"]["BTCUSDT"][key] is not None and p["_m"]["BTCUSDT"][key] < med]
    show("ABOVE median, all data", [p["_r"] for p in hi_g], "  ")
    show("BELOW median, all data", [p["_r"] for p in lo_g], "  ")
    print("  per slice, ABOVE-median only — must rescue the losing slice:")
    for lab, sub in SL:
        s = [p["_r"] for p in sub if p["_m"]["BTCUSDT"][key] is not None and p["_m"]["BTCUSDT"][key] >= med]
        show(lab, s)
    print()

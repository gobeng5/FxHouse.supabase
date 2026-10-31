"""Strategy 6: FX London breakout of the Asian range, day trade. Europe/London, M15.

  Asian range 00:00-07:00, midpoint = (H+L)/2. Entry window: bars opening 07:00..09:45.
  First bar closing outside the range: above -> long, below -> short; enter at close. Only
  the first breakout counts. Stop = midpoint, target 1.5R, time exit 16:00 (close of 15:45).
  Skip ranges: EURUSD < 15 or > 45 pips; GBPUSD < 20 or > 60 pips. Skip CPI/NFP/FOMC days.
  Combined: both pairs same direction against USD on one day -> only the first trigger
  (same bar: the worse result is kept, the conservative choice). Max one trade per pair/day.
"""
from datetime import time

import engine as E
import news as N

FILE = "data.json"
PAIRS = {"EURUSD": ("EUR/USD", 15, 45), "GBPUSD": ("GBP/USD", 20, 60)}


def run_pair(sym):
    inst, lo_pips, hi_pips = PAIRS[sym]
    m15 = E.load_json(FILE, inst, "m15", "Europe/London")
    trades, skips = [], []
    for day, g in m15.groupby(m15.index.date):
        if day.weekday() >= 5:
            continue
        ds, t = str(day), g.index.time
        if (nd := N.news_day(day)): skips.append(E.Skip(ds, nd)); continue
        asia = g[t < time(7)]
        if len(asia) < 24: skips.append(E.Skip(ds, f"missing data: {len(asia)}/28 Asian bars")); continue
        hi, lo = asia.high.max(), asia.low.min()
        mid, pips = (hi + lo) / 2, (hi - lo) / 0.0001
        if pips < lo_pips: skips.append(E.Skip(ds, f"range too narrow: {pips:.1f} pips")); continue
        if pips > hi_pips: skips.append(E.Skip(ds, f"range too wide: {pips:.1f} pips")); continue
        sig = None
        for ts, b in g[(t >= time(7)) & (t <= time(9, 45))].iterrows():
            if b.close > hi: sig = (ts, b, 1); break
            if b.close < lo: sig = (ts, b, -1); break
        if sig is None: skips.append(E.Skip(ds, "no breakout")); continue
        ts, b, d = sig
        hs = E.half_spread(sym, b.close)
        entry = b.close + d * hs
        if d * (entry - mid) <= 0: skips.append(E.Skip(ds, "entry not beyond stop")); continue
        tr = E.Trade(ds, "long" if d == 1 else "short", str(ts), entry, mid, entry + d * 1.5 * abs(entry - mid),
                     notes=f"range {pips:.1f} pips", instrument=inst)
        trades.append(E.manage(tr, g[(g.index > ts) & (t <= time(15, 45))], hs))
    return trades, skips, m15.index


def combine(eu, gu):
    """Same day, same direction against USD (both pairs share USD as quote): keep the first trigger."""
    by_day = {}
    for t in eu + gu:
        by_day.setdefault(t.date, []).append(t)
    out, skips = [], []
    for day, ts in by_day.items():
        if len(ts) == 2 and ts[0].direction == ts[1].direction:
            ts.sort(key=lambda t: (t.signal_time, t.r))
            out.append(ts[0]); skips.append(E.Skip(day, f"combined: {ts[1].instrument} dropped (same USD direction)"))
        else:
            out.extend(ts)
    return sorted(out, key=lambda t: t.signal_time), skips


if __name__ == "__main__":
    res = {}
    for sym in PAIRS:
        trades, skips, idx = run_pair(sym)
        res[sym] = trades
        s = E.report(f"S6_fx_london_{sym}", trades, skips, day_trade=True, split=E.split_at(idx))
        E.print_summary(f"S6 London breakout {sym} (Deriv, M15)", s)
    trades, skips = combine(res["EURUSD"], res["GBPUSD"])
    s = E.report("S6_fx_london_combined", trades, skips, day_trade=True, split=E.split_at(idx))
    E.print_summary("S6 London breakout combined EURUSD + GBPUSD", s)

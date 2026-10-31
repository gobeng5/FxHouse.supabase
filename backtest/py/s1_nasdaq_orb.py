"""Strategy 1: Nasdaq opening-range breakout (day trade), America/New_York.

  OR = high/low of 09:30–09:45 (the 09:30, 09:35, 09:40 M5 bars); midpoint = (H+L)/2.
  Entry window: M5 bars opening 09:45..10:25 (closing by 10:30). The first bar that closes
  beyond the OR with body >= 50% of its range; enter at its close. Only that first valid
  breakout counts. Stop = OR midpoint; target = 1.5R; time exit at the close of the 11:25 bar.
  Skip: OR width < 0.15% or > 0.6% of price (midpoint), FOMC day, CPI/NFP day, NYSE holiday
  or half day, missing OR bars. Max 1 trade per day.
"""
from datetime import time

import engine as E
import news as N

SYM = "NAS100"


def run():
    df = E.load(SYM, "M5", "America/New_York")
    trades, skips = [], []
    for day, g in df.groupby(df.index.date):
        if day.weekday() >= 5:
            continue
        ds = str(day)
        t = g.index.time
        if day in N.NYSE_CLOSED: skips.append(E.Skip(ds, "holiday")); continue
        if day in N.NYSE_HALF_DAY: skips.append(E.Skip(ds, "half day")); continue
        if day in N.FOMC: skips.append(E.Skip(ds, "FOMC day")); continue
        if day in N.CPI: skips.append(E.Skip(ds, "CPI morning")); continue
        if day in N.NFP: skips.append(E.Skip(ds, "NFP morning")); continue

        orb = g[(t >= time(9, 30)) & (t < time(9, 45))]
        if len(orb) != 3: skips.append(E.Skip(ds, f"missing data: {len(orb)}/3 OR bars")); continue
        hi, lo = orb.high.max(), orb.low.min()
        mid = (hi + lo) / 2
        width = (hi - lo) / mid * 100
        if width < 0.15: skips.append(E.Skip(ds, f"OR too narrow: {width:.3f}%")); continue
        if width > 0.6: skips.append(E.Skip(ds, f"OR too wide: {width:.3f}%")); continue

        win = g[(t >= time(9, 45)) & (t <= time(10, 25))]
        if win.empty: skips.append(E.Skip(ds, "missing data: no entry-window bars")); continue
        sig = None
        for ts, b in win.iterrows():
            rng = b.high - b.low
            if rng <= 0 or abs(b.close - b.open) < 0.5 * rng:
                continue
            if b.close > hi: sig = (ts, b, "long"); break
            if b.close < lo: sig = (ts, b, "short"); break
        if sig is None: skips.append(E.Skip(ds, "no valid breakout")); continue

        ts, b, direction = sig
        d = 1 if direction == "long" else -1
        hs = E.half_spread(SYM, b.close)
        entry = b.close + d * hs
        risk = abs(entry - mid)
        tr = E.Trade(ds, direction, str(ts), entry, mid, entry + d * 1.5 * risk,
                     notes=f"OR {lo:.2f}-{hi:.2f} width {width:.3f}%")
        after = g[(g.index > ts) & (t <= time(11, 25))]
        trades.append(E.manage(tr, after, hs))
    return trades, skips, df.index


if __name__ == "__main__":
    trades, skips, idx = run()
    s = E.report("S1_nasdaq_orb", trades, skips, day_trade=True, split=E.split_at(idx))
    E.print_summary("S1 Nasdaq ORB (Deriv OTC_NDX, M5)", s)

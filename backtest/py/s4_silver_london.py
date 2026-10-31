"""Strategy 4: silver London sweep of the Asian range, day trade. Europe/London, M15.

  Asian range: 00:00-07:00. Entry window: bars opening 07:00..11:45.
  Long: bar trades below the Asian low and closes back inside the range; enter at close.
  Short mirror with the Asian high. Stop: bar low - 0.1% of price (long; mirror).
  Target: opposite edge of the Asian range; skip the signal if it is < 1.5R away.
  Time exit 16:30 (close of the 16:15 bar). Skip CPI/NFP/FOMC days and days whose Asian
  range is wider than 1.2% of price. Max one trade per day.
"""
from datetime import time

import engine as E
import news as N

SYM, FILE, INST = "XAGUSD", "data-candidates.json", "XAG/USD"


def run():
    m15 = E.load_json(FILE, INST, "m15", "Europe/London")
    trades, skips = [], []
    for day, g in m15.groupby(m15.index.date):
        if day.weekday() >= 5:
            continue
        ds, t = str(day), g.index.time
        if (nd := N.news_day(day)): skips.append(E.Skip(ds, nd)); continue
        asia = g[t < time(7)]
        if len(asia) < 24: skips.append(E.Skip(ds, f"missing data: {len(asia)}/28 Asian bars")); continue
        hi, lo = asia.high.max(), asia.low.min()
        width = (hi - lo) / ((hi + lo) / 2) * 100
        if width > 1.2: skips.append(E.Skip(ds, f"Asian range too wide: {width:.2f}%")); continue
        reason, tr = "no sweep", None
        for ts, b in g[(t >= time(7)) & (t <= time(11, 45))].iterrows():
            if b.low < lo and lo < b.close < hi:
                d = 1
            elif b.high > hi and lo < b.close < hi:
                d = -1
            else:
                continue
            hs = E.half_spread(SYM, b.close)
            entry = b.close + d * hs
            stop = b.low - 0.001 * b.close if d == 1 else b.high + 0.001 * b.close
            target = hi if d == 1 else lo
            risk = abs(entry - stop)
            if d * (target - entry) < 1.5 * risk:
                reason = "target < 1.5R"; continue
            tr = E.Trade(ds, "long" if d == 1 else "short", str(ts), entry, stop, target,
                         notes=f"Asia {lo}-{hi} ({width:.2f}%)", instrument=INST)
            trades.append(E.manage(tr, g[(g.index > ts) & (t <= time(16, 15))], hs))
            break
        if tr is None:
            skips.append(E.Skip(ds, reason))
    return trades, skips, m15.index


if __name__ == "__main__":
    trades, skips, idx = run()
    s = E.report("S4_silver_london", trades, skips, day_trade=True, split=E.split_at(idx))
    E.print_summary("S4 Silver London sweep (Deriv frxXAGUSD, M15)", s)

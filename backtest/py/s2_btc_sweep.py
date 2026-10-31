"""Strategy 2: BTC liquidity sweep, day trade. UTC, weekdays only, M15.

  Bias: last CLOSED 4H candle vs 4H EMA50 (above -> longs only, below -> shorts only).
  Levels: previous UTC day's high/low; today's Asian (00:00-07:00) high/low.
  Entry window: M15 bars opening 07:00..19:45. Long: bar trades below a low and closes back
  above it; enter at close. Short mirror with the highs.
  Stop: sweep-bar low - 0.1% of price (long) / high + 0.1% (short). Target 2R. Time exit 23:00
  (close of the 22:45 bar). Skip a signal if stop distance < 0.3% or > 1.5% of price, or if
  the signal bar is within 30 min of a CPI/NFP/FOMC release. Max one trade per day.
"""
from datetime import time

import numpy as np
import pandas as pd

import engine as E
import news as N

SYM, FILE, INST = "BTCUSD", "data-candidates.json", "BTC/USD"
H4, M15 = pd.Timedelta(hours=4), pd.Timedelta(minutes=15)


def run():
    m15 = E.load_json(FILE, INST, "m15", "UTC")
    h4 = E.load_json(FILE, INST, "h4", "UTC")
    e = E.ema(h4.close, 50)
    bias = pd.Series(np.where(e.isna(), 0, np.sign(h4.close - e)), index=h4.index + H4)  # known at 4H close
    rel = pd.DatetimeIndex(N.release_times_utc())
    days = {d: g for d, g in m15.groupby(m15.index.date)}
    trades, skips = [], []
    for day, g in days.items():
        if day.weekday() >= 5:
            continue
        ds, t = str(day), g.index.time
        prev = days.get(day - pd.Timedelta(days=1))
        asia = g[t < time(7)]
        if prev is None or len(prev) < 80 or len(asia) < 24:
            skips.append(E.Skip(ds, "missing data")); continue
        lows, highs = [prev.low.min(), asia.low.min()], [prev.high.max(), asia.high.max()]
        win = g[(t >= time(7)) & (t <= time(19, 45))]
        reason, tr = "no sweep", None
        for ts, b in win.iterrows():
            close_t = ts + M15
            k = bias.index.searchsorted(close_t, side="right") - 1
            bz = bias.iloc[k] if k >= 0 else 0
            if bz > 0 and any(b.low < L < b.close for L in lows):
                d = 1
            elif bz < 0 and any(b.high > H > b.close for H in highs):
                d = -1
            else:
                continue
            if ((rel >= ts - pd.Timedelta(minutes=30)) & (rel <= close_t + pd.Timedelta(minutes=30))).any():
                reason = "news window"; continue
            hs = E.half_spread(SYM, b.close)
            entry = b.close + d * hs
            stop = b.low - 0.001 * b.close if d == 1 else b.high + 0.001 * b.close
            dist = abs(entry - stop) / entry * 100
            if dist < 0.3 or dist > 1.5:
                reason = f"stop distance {dist:.2f}%"; continue
            tr = E.Trade(ds, "long" if d == 1 else "short", str(ts), entry, stop,
                         entry + d * 2 * abs(entry - stop), instrument=INST)
            after = g[(g.index > ts) & (t <= time(22, 45))]
            trades.append(E.manage(tr, after, hs))
            break
        if tr is None:
            skips.append(E.Skip(ds, reason))
    return trades, skips, m15.index


if __name__ == "__main__":
    trades, skips, idx = run()
    s = E.report("S2_btc_sweep", trades, skips, day_trade=True, split=E.split_at(idx))
    E.print_summary("S2 BTC liquidity sweep (Deriv cryBTCUSD, M15)", s)

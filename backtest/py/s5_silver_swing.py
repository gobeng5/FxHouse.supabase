"""Strategy 5: silver swing, retest of the daily breakout level. Daily candles.

  Trend: daily close > EMA50 -> longs only; below -> shorts only (checked at breakout and entry).
  Breakout (long): close above the highest high of the previous 20 days; that high = level.
  Pullback: within the next 15 days, price trades within 0.5 x ATR(14) of the level
  (ATR as of the breakout day). Cancel if any close is more than 1 x ATR below the level.
  Entry: first day inside that zone that closes above its open; enter at its close.
  Stop: entry - 1.5 x ATR(14) (ATR as of the entry day). Exit: 3R or a close below EMA50.
  Shorts mirror. A newer breakout replaces a pending setup. One trade at a time.
"""
import numpy as np
import pandas as pd

import engine as E

SYM, FILE, INST = "XAGUSD", "data-candidates.json", "XAG/USD"


def run(file=FILE, inst=INST, sym=SYM):
    d1 = E.load_json(file, inst, "d1", "UTC")
    d1 = d1[d1.index.dayofweek < 5]
    e50, atr = E.ema(d1.close, 50), E.atr_wilder(d1, 14)
    hh, ll = d1.high.rolling(20).max().shift(), d1.low.rolling(20).min().shift()
    exit_long, exit_short = d1.close < e50, d1.close > e50
    trades, skips = [], []
    i, n, setup = 20, len(d1), None
    while i < n:
        ts, b = d1.index[i], d1.iloc[i]
        if np.isnan(e50.iloc[i]) or np.isnan(atr.iloc[i]):
            i += 1; continue
        trend = 1 if b.close > e50.iloc[i] else -1 if b.close < e50.iloc[i] else 0
        if setup is not None:
            d, lvl, a = setup["dir"], setup["level"], setup["atr"]
            setup["days"] += 1
            if setup["days"] > 15:
                skips.append(E.Skip(str(setup["ts"].date()), "no retest entry in 15 days")); setup = None
            elif d * (b.close - lvl) < -a:
                skips.append(E.Skip(str(setup["ts"].date()), "cancelled: close > 1 ATR through level")); setup = None
            elif b.low <= lvl + 0.5 * a and b.high >= lvl - 0.5 * a and d * (b.close - b.open) > 0 and trend == d:
                hs = E.half_spread(sym, b.close)
                entry = b.close + d * hs
                stop = entry - d * 1.5 * atr.iloc[i]
                tr = E.Trade(str(ts.date()), "long" if d == 1 else "short", str(ts), entry, stop,
                             entry + d * 3 * abs(entry - stop), notes=f"level {lvl}", instrument=inst)
                tr = E.manage(tr, d1.iloc[i + 1:], hs, exit_long if d == 1 else exit_short, last_is_time_exit=False)
                trades.append(tr); setup = None
                if not tr.exit_time:
                    break
                i = d1.index.get_loc(pd.Timestamp(tr.exit_time)) + 1
                continue
        if trend == 1 and b.close > hh.iloc[i]:
            setup = {"dir": 1, "level": hh.iloc[i], "atr": atr.iloc[i], "days": 0, "ts": ts}
        elif trend == -1 and b.close < ll.iloc[i]:
            setup = {"dir": -1, "level": ll.iloc[i], "atr": atr.iloc[i], "days": 0, "ts": ts}
        i += 1
    return trades, skips, d1.index


if __name__ == "__main__":
    trades, skips, idx = run()
    s = E.report("S5_silver_swing", trades, skips, day_trade=False, split=E.split_at(idx))
    E.print_summary("S5 Silver swing breakout retest (Deriv frxXAGUSD, D1)", s)

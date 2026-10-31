"""Strategy 7: FX swing, pullback in the daily trend. EURUSD and GBPUSD, daily candles.

  Trend: close > EMA50 and EMA50 > EMA200 -> longs only; opposite -> shorts only.
  Setup: a day touches the EMA20 (low <= EMA20 <= high) while the trend holds.
  Entry: within the next 5 days, the first close above the previous day's high (long) /
  below its low (short), trend still valid; enter at the close. Else cancelled.
  Stop: the pullback's extreme (lowest low from the touch day to the entry day) and at least
  1 x ATR(14) from entry. Exit: 2.5R target or a close back through the EMA50.
  Combined: only one USD-pair swing open at a time (the earlier signal wins).
"""
import numpy as np
import pandas as pd

import engine as E

FILE = "data-d1-long.json"
PAIRS = {"EURUSD": "EUR/USD", "GBPUSD": "GBP/USD"}


def run_pair(sym):
    inst = PAIRS[sym]
    d1 = load_d1(inst)
    e20, e50, e200 = E.ema(d1.close, 20), E.ema(d1.close, 50), E.ema(d1.close, 200)
    atr = E.atr_wilder(d1, 14)
    trend = pd.Series(np.select([(d1.close > e50) & (e50 > e200), (d1.close < e50) & (e50 < e200)], [1, -1], 0),
                      index=d1.index)
    exit_long, exit_short = d1.close < e50, d1.close > e50
    trades, skips = [], []
    i, n, setup = 1, len(d1), None
    while i < n:
        ts, b = d1.index[i], d1.iloc[i]
        tz = int(trend.iloc[i])
        if setup is not None:
            setup["days"] += 1
            d = setup["dir"]
            if setup["days"] > 5:
                skips.append(E.Skip(str(setup["ts"].date()), "no entry within 5 days")); setup = None
            elif tz == d and ((d == 1 and b.close > d1.high.iloc[i - 1]) or (d == -1 and b.close < d1.low.iloc[i - 1])):
                hs = E.half_spread(sym, b.close)
                entry = b.close + d * hs
                seg = d1.iloc[setup["i"]: i + 1]
                ext = seg.low.min() if d == 1 else seg.high.max()
                stop = min(ext, entry - atr.iloc[i]) if d == 1 else max(ext, entry + atr.iloc[i])
                tr = E.Trade(str(ts.date()), "long" if d == 1 else "short", str(ts), entry, stop,
                             entry + d * 2.5 * abs(entry - stop), instrument=inst)
                tr = E.manage(tr, d1.iloc[i + 1:], hs, exit_long if d == 1 else exit_short, last_is_time_exit=False)
                trades.append(tr); setup = None
                if not tr.exit_time:
                    break
                i = d1.index.get_loc(pd.Timestamp(tr.exit_time)) + 1
                continue
        if setup is None and tz != 0 and not np.isnan(e20.iloc[i]) and b.low <= e20.iloc[i] <= b.high:
            setup = {"dir": tz, "i": i, "ts": ts, "days": 0}
        i += 1
    return trades, skips, d1.index


def load_d1(inst):
    import json
    if FILE not in E._JSON:
        E._JSON[FILE] = json.load(open(E.ROOT.parent / FILE, encoding="utf-8"))
    raw = E._JSON[FILE][inst]
    rows = raw if isinstance(raw, list) else raw["d1"]
    d = pd.DataFrame(rows)
    d = d[d.epoch % 86400 == 0].drop_duplicates("epoch").sort_values("epoch")
    d.index = pd.to_datetime(d.epoch, unit="s", utc=True)
    d = d[d.index.dayofweek < 5]
    return d[["open", "high", "low", "close"]]


def combine(a, b):
    """One USD-pair swing open at a time: walk signals in time order, drop any that overlap."""
    out, skips, busy_until = [], [], None
    for t in sorted(a + b, key=lambda t: t.signal_time):
        if busy_until is not None and t.signal_time <= busy_until:
            skips.append(E.Skip(t.date, f"combined: {t.instrument} dropped, other USD swing open")); continue
        out.append(t); busy_until = t.exit_time or "9999"
    return out, skips


if __name__ == "__main__":
    res = {}
    for sym in PAIRS:
        trades, skips, idx = run_pair(sym)
        res[sym] = trades
        s = E.report(f"S7_fx_swing_{sym}", trades, skips, day_trade=False, split=E.split_at(idx))
        E.print_summary(f"S7 FX swing pullback {sym} (Deriv, D1)", s)
    trades, skips = combine(res["EURUSD"], res["GBPUSD"])
    s = E.report("S7_fx_swing_combined", trades, skips, day_trade=False, split=E.split_at(idx))
    E.print_summary("S7 FX swing combined EURUSD + GBPUSD", s)

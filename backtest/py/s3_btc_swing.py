"""Strategy 3: BTC swing. UTC; daily bias, 4H setup and entry.

  Bias (last closed daily): close > EMA50 and EMA50 > EMA200 -> longs; opposite -> shorts.
  Setup: a 4H candle touches the 4H EMA50 (low <= EMA <= high).
  Entry: within the next 5 4H candles, the first that closes above the previous 4H high
  (long) / below its low (short), with the bias still valid. Else the setup is cancelled.
  Stop: lowest low since the touch (touch bar to entry bar) - 0.5% of price (long; mirror).
  Skip if stop > 8% from entry.
  Exit: 3R target, or a daily close below the daily EMA50 (long) / above (short).
  One trade at a time.
"""
import numpy as np
import pandas as pd

import engine as E

SYM, FILE, INST = "BTCUSD", "data-candidates.json", "BTC/USD"
D1, H4 = pd.Timedelta(days=1), pd.Timedelta(hours=4)


def run():
    d1 = E.load_json(FILE, INST, "d1", "UTC")
    h4 = E.load_json(FILE, INST, "h4", "UTC")
    e50, e200 = E.ema(d1.close, 50), E.ema(d1.close, 200)
    bias = pd.Series(np.select([(d1.close > e50) & (e50 > e200), (d1.close < e50) & (e50 < e200)], [1, -1], 0),
                     index=d1.index + D1)  # known at the daily close
    # Daily close vs EMA50, placed on the 4H bar that closes at the same instant.
    close_vs = pd.Series(np.sign(d1.close - e50).fillna(0).to_numpy(), index=d1.index + D1)
    h4_close = h4.index + H4
    on_daily_close = pd.Series(close_vs.reindex(h4_close).to_numpy(), index=h4.index)
    exit_long, exit_short = on_daily_close < 0, on_daily_close > 0
    he = E.ema(h4.close, 50)

    trades, skips = [], []
    i, n, setup = 1, len(h4), None
    while i < n:
        ts, b = h4.index[i], h4.iloc[i]
        k = bias.index.searchsorted(h4_close[i], side="right") - 1
        bz = int(bias.iloc[k]) if k >= 0 else 0
        if setup is not None:
            setup["count"] += 1
            if setup["count"] > 5:
                skips.append(E.Skip(str(setup["ts"].date()), "setup cancelled: no entry in 5 bars"))
                setup = None
            else:
                d = setup["dir"]
                prev = h4.iloc[i - 1]
                if bz == d and ((d == 1 and b.close > prev.high) or (d == -1 and b.close < prev.low)):
                    hs = E.half_spread(SYM, b.close)
                    entry = b.close + d * hs
                    seg = h4.iloc[setup["i"]: i + 1]
                    stop = seg.low.min() - 0.005 * entry if d == 1 else seg.high.max() + 0.005 * entry
                    setup = None
                    if abs(entry - stop) / entry > 0.08:
                        skips.append(E.Skip(str(ts.date()), "stop > 8% from entry"))
                    else:
                        tr = E.Trade(str(ts.date()), "long" if d == 1 else "short", str(ts), entry, stop,
                                     entry + d * 3 * abs(entry - stop), instrument=INST)
                        after = h4.iloc[i + 1:]
                        tr = E.manage(tr, after, hs, exit_long if d == 1 else exit_short, last_is_time_exit=False)
                        trades.append(tr)
                        if tr.exit_time:
                            i = h4.index.get_loc(pd.Timestamp(tr.exit_time)) + 1
                            continue
                        break
        if setup is None and bz != 0 and not np.isnan(he.iloc[i]) and b.low <= he.iloc[i] <= b.high:
            setup = {"dir": bz, "i": i, "ts": ts, "count": 0}
        i += 1
    return trades, skips, h4.index


if __name__ == "__main__":
    trades, skips, idx = run()
    s = E.report("S3_btc_swing", trades, skips, day_trade=False, split=E.split_at(idx))
    E.print_summary("S3 BTC swing (Deriv cryBTCUSD, D1 + H4)", s)

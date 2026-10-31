"""Train / holdout test of #3 multi-horizon trend (10/20/40-day Donchian composite, ATR stops).

Per instrument: the first 60% of the history is the train period, the last 40% the holdout.
The ATR multiple (2.4 / 3.0 / 3.6, default 3.0) is chosen on train by total R (ties -> default)
and then traded unchanged on the holdout. Rules are those of ssrn_sweep.s3_trend.
BTC/USD: Binance BTCUSDT H1 (Sep 2023 - Oct 2025) joined to Deriv (Oct 2025 - Oct 2026).
"""
import numpy as np
import pandas as pd

import engine as E
import ssrn_sweep as S
from ssrn_forward import csv_h1, EXT

INSTS = ["XAU/USD", "EUR/USD", "BTC/USD", "AUD/USD", "GBP/USD"]
GRID, DEFAULT = (2.4, 3.0, 3.6), 3.0


def btc_long() -> pd.DataFrame:
    deriv = E.load_json(S.SOURCES["BTC/USD"], "BTC/USD", "h1", S.ET)
    old = csv_h1(EXT / "BTCUSD_binance_H1.csv")
    return pd.concat([old[old.index < deriv.index[0]], deriv])


def stats(ts):
    r = np.array([t.r for t in ts])
    if not len(r):
        return "n   0"
    t = r.mean() / r.std(ddof=1) * np.sqrt(len(r)) if len(r) > 1 and r.std(ddof=1) > 0 else 0
    eq = np.concatenate([[0], r.cumsum()])
    return (f"n {len(r):3d}  win {(r > 0).mean() * 100:4.0f}%  exp {r.mean():+.3f}R  total {r.sum():+6.2f}R  "
            f"t {t:+.2f}  DD {(np.maximum.accumulate(eq) - eq).max():.1f}R")


if __name__ == "__main__":
    S._cache["BTC/USD"] = S.Bars(btc_long())
    pooled_hold = []
    for inst in INSTS:
        B = S.h1(inst)
        cut = B.idx[0] + (B.idx[-1] - B.idx[0]) * 0.6
        runs = {m: S.s3_trend(m, [inst]) for m in GRID}
        train = {m: [t for t in ts if pd.Timestamp(t.t0) < cut] for m, ts in runs.items()}
        hold = {m: [t for t in ts if pd.Timestamp(t.t0) >= cut] for m, ts in runs.items()}
        pick = max(GRID, key=lambda m: (round(sum(t.r for t in train[m]), 9), m == DEFAULT))
        pooled_hold += hold[pick]
        print(f"\n=== {inst}  {B.idx[0]:%Y-%m-%d} .. {B.idx[-1]:%Y-%m-%d}, holdout from {cut:%Y-%m-%d}")
        for m in GRID:
            print(f"  ATR x{m}: train {stats(train[m])}   |  holdout {stats(hold[m])}")
        print(f"  chosen on train: x{pick}  ->  HOLDOUT {stats(hold[pick])}")
    print(f"\nPOOLED HOLDOUT (train-chosen multiple per instrument): {stats(pooled_hold)}")
    pd.DataFrame([vars(t) for t in pooled_hold]).to_csv(E.OUT / "ssrn_trend_holdout.csv", index=False)

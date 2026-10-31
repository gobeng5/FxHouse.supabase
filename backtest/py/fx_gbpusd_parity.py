"""Compare the shared TypeScript GBP/USD z-score gem with the Python test (fx_playbook.py).

Python signals = every bar where the rule fires (no one-trade-at-a-time), mean + 1 sd target,
no z/ADX exits, no news filter. Then both signal sets are traded one at a time with the same
simulator and the train / holdout results compared.
"""
import json

import numpy as np
import pandas as pd

import engine as E
import fx_playbook as P

ts_sig = json.load(open(E.OUT / "gbpusd_zscore_ts.json"))
df = P.h1("GBP/USD")
ts_set = {(pd.Timestamp(x["trigger"] - 3600, unit="s", tz="UTC"), x["dir"]): x for x in ts_sig}

# Python: all firing bars (re-run the rule with no position blocking).
trades, _ = P.zscore_mr("GBP/USD", target="+1sd", manage_exits=False, us_news=False)
py_trade_keys = {(t.t_signal, t.d) for t in trades}
missing = [k for k in py_trade_keys if k not in ts_set]
print(f"TS signals {len(ts_sig)}; Python trades {len(trades)}; Python trades with no TS signal on the same bar: {len(missing)}")
for k in sorted(missing)[:10]:
    print("   missing", k)

# Trade the TS signals one at a time with the same simulator (entry next open, TS stop/target).
idx = {t: i for i, t in enumerate(df.index)}
out, busy = [], -1
for (t0, d), x in sorted(ts_set.items()):
    i = idx.get(t0)
    if i is None or i <= busy:
        continue
    t = P.simulate(df, i, d, x["stop"], x["target"], "GBP/USD", be=False, time_bars=10)
    if t:
        out.append(t); busy = i + t.bars
a, b = df.index[0], df.index[-1]
cut = a + (b - a) * 0.6
for name, ts in (("TypeScript gem", out), ("Python test   ", trades)):
    tr, ho = [t for t in ts if t.t_signal < cut], [t for t in ts if t.t_signal >= cut]
    print(f"{name} full {P.fmt(P.stats(ts))}")
    print(f"{'':14s} train exp {P.stats(tr).get('exp', np.nan):+.3f}R ({len(tr)})  holdout exp {P.stats(ho).get('exp', np.nan):+.3f}R ({len(ho)})")

# Benchmark row for strategyHealth (full year of the TS version).
r = np.array([t.r for t in out])
streak = best = 0
for v in r:
    streak = streak + 1 if v < 0 else 0
    best = max(best, streak)
atr = (df.high - df.low).rolling(14).mean()
pct = atr.rolling(200).apply(lambda w: (w[:-1] < w[-1]).mean() * 100, raw=True)
reg = {}
for t in out:
    p = pct.get(t.t_signal, np.nan)
    k = "wild" if p >= 75 else "quiet" if p < 25 else "normal"
    reg.setdefault(k, []).append(t.r)
print(f"benchmark: avgR {r.mean():.3f} sdR {r.std(ddof=1):.3f} winRate {(r > 0).mean() * 100:.1f} worstLosingStreak {best} tradesPerYear {len(r)}")
print("byRegime: " + ", ".join(f"{k}: n {len(v)} avgR {np.mean(v):.3f}" for k, v in reg.items()))

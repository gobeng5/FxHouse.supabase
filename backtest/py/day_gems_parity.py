"""Trade the TypeScript day-gem signals (backtest/day-gems-parity.ts) one at a time with the
day_study simulator, entry at the engine's hourly run, and compare with the Python study.
Also prints the strategyHealth benchmark row for each."""
import json

import numpy as np
import pandas as pd

import day_study as S
import engine as E

sig = json.load(open(E.OUT / "day_gems_ts.json"))
for inst, hold in (("XAU/USD", 10), ("V75", 12)):
    D = S.Data(inst)
    a, b = D.h1.index[0], D.h1.index[-1]; cut = a + (b - a) * 0.6
    rows = [(pd.Timestamp(x["trigger"], unit="s", tz="UTC"), pd.Timestamp(x["gen"], unit="s", tz="UTC"), x["dir"], x["stop"], x["target"]) for x in sig[inst]]
    ts = S.one_at_a_time(D, rows, hold)
    tr, ho = [t for t in ts if t.t < cut], [t for t in ts if t.t >= cut]
    s0, s1, s2 = S.st(ts), S.st(tr), S.st(ho)
    print(f"{inst} TS gem: full {s0['exp']:+.3f}R ({s0['n']}, win {s0['win']:.0f}%)  train {s1['exp']:+.3f}R ({s1['n']})  holdout {s2['exp']:+.3f}R ({s2['n']})  luck {S.luck(ts) * 100:.1f}%")
    r = np.array([t.r for t in ts]); streak = best = 0
    for v in r:
        streak = streak + 1 if v < 0 else 0; best = max(best, streak)
    atr = (D.h1.high - D.h1.low).rolling(14).mean()
    pct = atr.rolling(200).apply(lambda w: (w[:-1] < w[-1]).mean() * 100, raw=True)
    reg = {}
    for t in ts:
        p = pct.asof(t.t) if len(pct) else np.nan
        reg.setdefault("wild" if p >= 75 else "quiet" if p < 25 else "normal", []).append(t.r)
    print(f"   benchmark avgR {r.mean():.3f} sdR {r.std(ddof=1):.3f} winRate {(r > 0).mean() * 100:.1f} worstLosingStreak {best} tradesPerYear {len(r)}; "
          + ", ".join(f"{k}: n {len(v)} avgR {np.mean(v):.3f}" for k, v in reg.items()))

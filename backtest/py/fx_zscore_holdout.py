"""Train / holdout test of the playbook's z-score rules on GBP/USD, AUD/USD and EUR/GBP.

  * Train = first 60% of each pair's year, holdout = last 40%.
  * The target (halfway to the mean, the mean, mean +0.5 sd, mean +1 sd) is chosen on
    train by expectancy, then traded unchanged on the holdout.
  * Thirds: the chosen target over the year in three equal periods (stability).
  * Luck test: 2,000 runs where each trade's direction is a coin flip (same entry bar,
    same stop and target distances, same time stop). The share of runs that match the
    strategy's holdout total is the chance the result is luck.
Rules and mechanics are those of fx_playbook.py.

Run:  .venv\\Scripts\\python fx_zscore_holdout.py
"""
import numpy as np
import pandas as pd

import engine as E
import fx_playbook as P

TARGETS = ("half", "mean", "+0.5sd", "+1sd")
PAIRS = {
    "GBP/USD": dict(),
    "AUD/USD": dict(),
    "EUR/GBP": dict(look=30, adx_max=22, time_bars=12, min_dist_spreads=4, session=True, ctx_4h=True, us_news=False),
}
TIME_BARS = {"GBP/USD": 10, "AUD/USD": 10, "EUR/GBP": 12}


def mirror(df, t, inst):
    """Opposite direction, same entry bar, same stop/target distances, same time stop."""
    i = df.index.get_loc(t.t_signal)
    dist_s, dist_t = abs(t.entry - t.stop), abs(t.target - t.entry)
    entry = df.open.iloc[i + 1] - t.d * P.SPREAD[inst] / 2
    m = P.simulate(df, i, -t.d, entry + t.d * dist_s, entry - t.d * dist_t, inst, be=False, time_bars=TIME_BARS[inst])
    return m.r if m else 0.0


def luck(df, ts, inst, sims=2000):
    if not ts:
        return np.nan
    a = np.array([t.r for t in ts]); b = np.array([mirror(df, t, inst) for t in ts])
    pick = np.random.default_rng(11).random((sims, len(a))) < 0.5
    return float((np.where(pick, a, b).sum(axis=1) >= a.sum()).mean())


if __name__ == "__main__":
    rows = []
    for inst, kw in PAIRS.items():
        runs = {tg: P.zscore_mr(inst, target=tg, **kw) for tg in TARGETS}
        df = runs["mean"][1]
        a, b = df.index[0], df.index[-1]
        cut = a + (b - a) * 0.6
        tr = {k: [t for t in ts if t.t_signal < cut] for k, (ts, _) in runs.items()}
        ho = {k: [t for t in ts if t.t_signal >= cut] for k, (ts, _) in runs.items()}
        print(f"\n=== {inst} z-score  {a:%Y-%m-%d} .. {b:%Y-%m-%d}; holdout from {cut:%Y-%m-%d}")
        for k in TARGETS:
            print(f"  {k:7s} train   {P.fmt(P.stats(tr[k]))}")
            print(f"  {'':7s} holdout {P.fmt(P.stats(ho[k]))}")
        pick = max(TARGETS, key=lambda k: (P.stats(tr[k]).get("exp", -9), k == "mean"))
        full = runs[pick][0]
        thirds = [a + (b - a) * f for f in (0, 1 / 3, 2 / 3, 1.0001)]
        th = [P.stats([t for t in full if thirds[k] <= t.t_signal < thirds[k + 1]]) for k in range(3)]
        p_luck = luck(df, ho[pick], inst)
        s_tr, s_ho = P.stats(tr[pick]), P.stats(ho[pick])
        print(f"  -> chosen on train: {pick}")
        print(f"     HOLDOUT {P.fmt(s_ho)}")
        print(f"     thirds of the year: " + " / ".join(f"{x.get('exp', float('nan')):+.3f}R ({x.get('n', 0)})" for x in th))
        print(f"     luck test: {p_luck * 100:.1f}% of coin-flip runs match the holdout total")
        rows.append((inst, pick, s_tr, s_ho, th, p_luck))
        pd.DataFrame([{**vars(t), "target": k, "part": "train" if t.t_signal < cut else "holdout"}
                      for k, (ts, _) in runs.items() for t in ts]).drop(columns="extra") \
            .to_csv(E.OUT / f"fx_zscore_holdout_{inst.replace('/', '')}.csv", index=False)

    print("\nSUMMARY")
    for inst, pick, s_tr, s_ho, th, p in rows:
        thirds_txt = " / ".join("{:+.2f}".format(x.get("exp", np.nan)) for x in th)
        print(f"  {inst}  target {pick:6s}  train {s_tr.get('exp', np.nan):+.3f}R ({s_tr.get('n', 0)})  "
              f"holdout {s_ho.get('exp', np.nan):+.3f}R ({s_ho.get('n', 0)}, win {s_ho.get('win', 0):.0f}%, DD {s_ho.get('dd', 0):.1f}R)  "
              f"thirds {thirds_txt}  luck {p * 100:.0f}%")

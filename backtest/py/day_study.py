"""Day-trading study: intraday patterns per instrument, then day-trade strategies chosen on
train and judged on an untouched holdout.

Instruments: the live list (forex, gold, silver, US100, V10, V25, V75, BOOM1000), from the
saved Deriv year (backtest/data.json, data-candidates.json), M15 + H1.

Stage 1 — patterns (whole year, descriptive):
  * lag-1 autocorrelation of H1 returns (> 0 momentum, < 0 mean reversion);
  * the UTC hour with the strongest average drift and its t-stat;
  * Asian-range breakout follow-through: of days whose 07:00-11:00 UTC M15 closes break the
    00:00-07:00 range, the share that close the day beyond the broken side;
  * sweep reversal: of M15 bars (07-16 UTC) that trade beyond the previous-day or Asian
    high/low and close back inside, the share where price then reaches the opposite side of
    the Asian range before the stop beyond the sweep.

Stage 2 — strategies (all fit the live pipeline: one entry, fixed stop, fixed target, time
exit; max hold 8-12h, so all are day trades):
  ASIA_BO  M15 close beyond the 00-07 UTC range during 07-11 UTC; stop range mid or far side; TP 1/1.5/2R; 10h
  SWEEP    M15 sweep of prev-day / Asian high or low, close back inside (07-16 UTC); stop wick + 0.1 ATR; TP 1.5/2/3R; 8h
  DON      H1 close beyond the 20-bar high/low, body >= 60%, range >= 1 ATR; stop 1.5 ATR; TP 1.5/2/3R; 12h
  ZFADE    H1 20-bar z-score back inside +-2 / +-2.5; stop 1.5 ATR; TP the mean; 8h
  TOD      the hour-of-day drift found on TRAIN only (|t| >= 2): enter at that hour, hold 1-3h; stop 1.5 ATR
  PULLBACK H1 EMA20 > EMA50 trend, bar dips to EMA20 and closes up through it (mirror short); stop 1.5 ATR; TP 1.5/2R; 12h
  INSIDE   H1 inside bar, next close beyond the mother bar; stop the mother bar's far side; TP 1.5/2R; 12h

Mechanics: signal at a bar close, entry at the next M15 open + half spread; exits on M15 bars;
stop and target in one bar = stop; stops fill at the worse of stop and open plus half a spread
of slippage; half a spread on every exit; one trade at a time per strategy.

Selection: train = first 60% of the year. Per instrument the variant with the best train
t-stat (>= 20 train trades) is chosen and judged on the holdout (last 40%). Luck test: 2,000
coin-flip-direction runs over the holdout trades. PASS = train t > 1, holdout exp > +0.10R
with >= 12 trades, luck < 10%, and no losing third of the year.

Run:  .venv\\Scripts\\python day_study.py
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

import engine as E

FILES = {**{k: "data.json" for k in ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "GBP/JPY", "XAU/USD",
                                       "V10", "V25", "V75", "BOOM1000"]},
         **{k: "data-candidates.json" for k in ["XAG/USD", "US100"]}}
SPREAD = {"EUR/USD": 0.00008, "GBP/USD": 0.00012, "AUD/USD": 0.00011, "USD/JPY": 0.010, "GBP/JPY": 0.025,
          "XAU/USD": 0.30, "XAG/USD": 0.035, "US100": 2.5, "V10": 0.02, "V25": 0.10, "V75": 2.50, "BOOM1000": 0.60}
TRAIN = 0.6


@dataclass
class T:
    t: pd.Timestamp      # signal time (bar close)
    d: int
    r: float
    mirror: float
    reason: str
    exit_t: pd.Timestamp


class Data:
    def __init__(self, inst):
        self.inst = inst
        self.m15 = E.load_json(FILES[inst], inst, "m15", "UTC")
        self.h1 = E.load_json(FILES[inst], inst, "h1", "UTC")
        m = self.m15
        self.idx = m.index
        self.o, self.h, self.l, self.c = (m[k].to_numpy() for k in ("open", "high", "low", "close"))
        self.hs = SPREAD[inst] / 2
        self.atr_h1 = E.atr_wilder(self.h1, 14)
        self.atr_m15 = E.atr_wilder(m, 14)


def _run(D: Data, t_entry, d, stop, target, hold_h):
    j0 = D.idx.searchsorted(t_entry)
    if j0 >= len(D.idx):
        return None
    hs = D.hs
    entry = D.o[j0] + d * hs
    risk = abs(entry - stop)
    if risk <= 0 or d * (entry - stop) <= 0 or d * (target - entry) <= 0:
        return None
    end = t_entry + pd.Timedelta(hours=hold_h)
    j = j0
    while j < len(D.idx) and D.idx[j] < end:
        if (D.l[j] <= stop) if d == 1 else (D.h[j] >= stop):
            px = (min(stop, D.o[j]) if d == 1 else max(stop, D.o[j])) - d * 2 * hs
            return d * (px - entry) / risk, "stop", D.idx[j]
        if (D.h[j] >= target) if d == 1 else (D.l[j] <= target):
            return d * (target - d * hs - entry) / risk, "target", D.idx[j]
        j += 1
    j = max(j0, j - 1)
    return d * (D.c[j] - d * hs - entry) / risk, "time", D.idx[j]


def trade(D: Data, t_sig, t_entry, d, stop, target, hold_h):
    """Real trade plus its coin-flip twin (opposite direction, same distances and hold)."""
    res = _run(D, t_entry, d, stop, target, hold_h)
    if res is None:
        return None
    j0 = D.idx.searchsorted(t_entry)
    ent = D.o[j0]
    mres = _run(D, t_entry, -d, ent + d * abs(ent - stop), ent - d * abs(target - ent), hold_h)
    return T(t_sig, d, res[0], mres[0] if mres else 0.0, res[1], res[2])


def one_at_a_time(D, signals, hold_h):
    """signals: iterable of (t_sig, t_entry, d, stop, target) in time order."""
    out, busy = [], None
    for t_sig, t_entry, d, stop, tgt in signals:
        if busy is not None and t_entry <= busy:
            continue
        t = trade(D, t_sig, t_entry, d, stop, tgt, hold_h)
        if t:
            out.append(t); busy = t.exit_t
    return out


# ---- stage 1: patterns ----------------------------------------------------------------------
def patterns(D: Data) -> dict:
    h1 = D.h1
    ret = np.log(h1.close).diff()
    ac1 = ret.autocorr(1)
    by_hour = ret.groupby(h1.index.hour)
    tstat = (by_hour.mean() / by_hour.std() * np.sqrt(by_hour.count())).dropna()
    hbest = int(tstat.abs().idxmax())
    m = D.m15
    days = m.groupby(m.index.date)
    follow = []
    for _, g in days:
        t = g.index.hour
        asia, win = g[t < 7], g[(t >= 7) & (t < 11)]
        if len(asia) < 20 or win.empty:
            continue
        hi, lo = asia.high.max(), asia.low.min()
        brk = win[(win.close > hi) | (win.close < lo)]
        if brk.empty:
            continue
        d = 1 if brk.close.iloc[0] > hi else -1
        follow.append(d * (g.close.iloc[-1] - (hi if d == 1 else lo)) > 0)
    return {"ac1": ac1, "hour": hbest, "hour_t": float(tstat[hbest]),
            "hour_dir": "up" if tstat[hbest] > 0 else "down", "asia_follow": np.mean(follow) * 100 if follow else np.nan,
            "asia_days": len(follow)}


# ---- stage 2: strategy families -------------------------------------------------------------
def asia_breakout(D, tp, stop_mode):
    m = D.m15
    sig = []
    for day, g in m.groupby(m.index.date):
        t = g.index.hour
        asia, win = g[t < 7], g[(t >= 7) & (t < 11)]
        if len(asia) < 20 or win.empty:
            continue
        hi, lo = asia.high.max(), asia.low.min()
        for ts, b in win.iterrows():
            d = 1 if b.close > hi else -1 if b.close < lo else 0
            if d:
                stop = (hi + lo) / 2 if stop_mode == "mid" else (lo if d == 1 else hi)
                te = ts + pd.Timedelta(minutes=15)
                j = D.idx.searchsorted(te)
                if j < len(D.idx):
                    ent = D.o[j] + d * D.hs
                    sig.append((ts + pd.Timedelta(minutes=15), te, d, stop, ent + d * tp * abs(ent - stop)))
                break
    return one_at_a_time(D, sig, 10)


def sweep(D, tp):
    m = D.m15
    atr = D.atr_m15
    sig, prev = [], None
    for day, g in m.groupby(m.index.date):
        t = g.index.hour
        asia = g[t < 7]
        if prev is None or len(asia) < 20:
            prev = g; continue
        lows = [prev.low.min(), asia.low.min()]; highs = [prev.high.max(), asia.high.max()]
        for ts, b in g[(t >= 7) & (t < 16)].iterrows():
            a = atr.get(ts, np.nan)
            if np.isnan(a):
                continue
            d = 1 if any(b.low < L < b.close for L in lows) else -1 if any(b.high > H > b.close for H in highs) else 0
            if d:
                stop = b.low - 0.1 * a if d == 1 else b.high + 0.1 * a
                te = ts + pd.Timedelta(minutes=15)
                j = D.idx.searchsorted(te)
                if j < len(D.idx):
                    ent = D.o[j] + d * D.hs
                    sig.append((te, te, d, stop, ent + d * tp * abs(ent - stop)))
                break
        prev = g
    return one_at_a_time(D, sig, 8)


def h1_signals(D, fn, hold_h):
    """fn(i) -> (d, stop_dist or None, stop_abs or None, tp_R or None, target_abs or None)."""
    h1 = D.h1
    sig = []
    for i in range(60, len(h1)):
        res = fn(i)
        if not res:
            continue
        d, stop_abs, tp_r, tgt_abs = res
        te = h1.index[i] + pd.Timedelta(hours=1)
        j = D.idx.searchsorted(te)
        if j >= len(D.idx):
            continue
        ent = D.o[j] + d * D.hs
        stop = stop_abs(ent) if callable(stop_abs) else stop_abs
        tgt = tgt_abs if tgt_abs is not None else ent + d * tp_r * abs(ent - stop)
        sig.append((te, te, d, stop, tgt))
    return one_at_a_time(D, sig, hold_h)


def donchian(D, tp):
    h = D.h1; a = D.atr_h1.to_numpy()
    hi20, lo20 = h.high.rolling(20).max().shift().to_numpy(), h.low.rolling(20).min().shift().to_numpy()
    o, hh, ll, c = (h[k].to_numpy() for k in ("open", "high", "low", "close"))

    def fn(i):
        rng = hh[i] - ll[i]
        if np.isnan(a[i]) or rng < a[i] or abs(c[i] - o[i]) < 0.6 * rng:
            return None
        d = 1 if c[i] > hi20[i] and c[i] > o[i] else -1 if c[i] < lo20[i] and c[i] < o[i] else 0
        return (d, lambda e, d=d, x=a[i]: e - d * 1.5 * x, tp, None) if d else None
    return h1_signals(D, fn, 12)


def zfade(D, thr):
    h = D.h1; a = D.atr_h1.to_numpy(); c = h.close
    mean, sd = c.rolling(20).mean().to_numpy(), c.rolling(20).std(ddof=0).to_numpy()
    z = (c.to_numpy() - mean) / sd

    def fn(i):
        d = 1 if z[i - 1] < -thr <= z[i] else -1 if z[i - 1] > thr >= z[i] else 0
        if not d or np.isnan(a[i]):
            return None
        return (d, lambda e, d=d, x=a[i]: e - d * 1.5 * x, None, mean[i])
    return h1_signals(D, fn, 8)


def pullback(D, tp):
    h = D.h1; a = D.atr_h1.to_numpy()
    e20, e50 = E.ema(h.close, 20).to_numpy(), E.ema(h.close, 50).to_numpy()
    o, hh, ll, c = (h[k].to_numpy() for k in ("open", "high", "low", "close"))

    def fn(i):
        if np.isnan(e50[i]) or np.isnan(a[i]):
            return None
        if e20[i] > e50[i] and ll[i] <= e20[i] < c[i] and c[i] > o[i]:
            d = 1
        elif e20[i] < e50[i] and hh[i] >= e20[i] > c[i] and c[i] < o[i]:
            d = -1
        else:
            return None
        return (d, lambda e, d=d, x=a[i]: e - d * 1.5 * x, tp, None)
    return h1_signals(D, fn, 12)


def inside(D, tp):
    h = D.h1
    hh, ll, c = (h[k].to_numpy() for k in ("high", "low", "close"))

    def fn(i):
        if not (hh[i - 1] <= hh[i - 2] and ll[i - 1] >= ll[i - 2]):
            return None
        d = 1 if c[i] > hh[i - 2] else -1 if c[i] < ll[i - 2] else 0
        return (d, ll[i - 2] if d == 1 else hh[i - 2], tp, None) if d else None
    return h1_signals(D, fn, 12)


def tod(D, cut):
    """Hour-of-day drift found on train only; traded on the whole year with that choice."""
    h = D.h1
    r = h.close.pct_change().shift(-1)  # return of the NEXT bar, keyed by its opening hour - 1
    tr = h.index < cut
    best = None
    for hour in range(24):
        for k in (1, 2, 3):
            fwd = (h.close.shift(-k) / h.open.shift(0) - 1)[(h.index.hour == hour) & tr].dropna()
            if len(fwd) < 60:
                continue
            t = fwd.mean() / fwd.std() * np.sqrt(len(fwd))
            if best is None or abs(t) > abs(best[2]):
                best = (hour, k, t)
    if best is None or abs(best[2]) < 2:
        return [], None
    hour, k, t = best
    d = 1 if t > 0 else -1
    a = D.atr_h1
    sig = []
    for i in np.where(h.index.hour == hour)[0]:
        ts = h.index[i]
        x = a.iloc[i - 1] if i > 0 else np.nan
        if np.isnan(x):
            continue
        j = D.idx.searchsorted(ts)
        if j >= len(D.idx):
            continue
        ent = D.o[j] + d * D.hs
        sig.append((ts, ts, d, ent - d * 1.5 * x, ent + d * 50 * x))   # target out of reach: exit by time
    return one_at_a_time(D, sig, k), f"{hour:02d}:00 UTC {'long' if d == 1 else 'short'} {k}h (train t {t:+.1f})"


def variants(D, cut):
    v = {}
    for tp in (1.0, 1.5, 2.0):
        for sm in ("mid", "far"):
            v[f"ASIA_BO tp{tp} stop-{sm}"] = asia_breakout(D, tp, sm)
    for tp in (1.5, 2.0, 3.0):
        v[f"SWEEP tp{tp}"] = sweep(D, tp)
        v[f"DON tp{tp}"] = donchian(D, tp)
    for thr in (2.0, 2.5):
        v[f"ZFADE z{thr}"] = zfade(D, thr)
    for tp in (1.5, 2.0):
        v[f"PULLBACK tp{tp}"] = pullback(D, tp)
        v[f"INSIDE tp{tp}"] = inside(D, tp)
    ts, label = tod(D, cut)
    if label:
        v[f"TOD {label}"] = ts
    return v


# ---- evaluation -----------------------------------------------------------------------------
def st(ts):
    r = np.array([t.r for t in ts])
    if len(r) < 2:
        return {"n": len(r), "exp": r.mean() if len(r) else np.nan, "t": 0.0, "win": (r > 0).mean() * 100 if len(r) else 0, "dd": 0}
    eq = np.concatenate([[0], r.cumsum()])
    return {"n": len(r), "exp": r.mean(), "t": r.mean() / r.std(ddof=1) * np.sqrt(len(r)) if r.std() > 0 else 0,
            "win": (r > 0).mean() * 100, "dd": (np.maximum.accumulate(eq) - eq).max(), "total": r.sum()}


def luck(ts, sims=2000):
    if not ts:
        return np.nan
    a = np.array([t.r for t in ts]); b = np.array([t.mirror for t in ts])
    pick = np.random.default_rng(5).random((sims, len(a))) < 0.5
    return float((np.where(pick, a, b).sum(axis=1) >= a.sum()).mean())


if __name__ == "__main__":
    E.OUT.mkdir(exist_ok=True)
    summary, pat_rows = [], []
    for inst in FILES:
        D = Data(inst)
        a, b = D.h1.index[0], D.h1.index[-1]
        cut = a + (b - a) * TRAIN
        p = patterns(D)
        pat_rows.append((inst, p))
        V = variants(D, cut)
        print(f"\n=== {inst}  {a:%Y-%m-%d} .. {b:%Y-%m-%d}; holdout from {cut:%Y-%m-%d}")
        print(f"  patterns: H1 lag-1 autocorr {p['ac1']:+.3f} ({'momentum' if p['ac1'] > 0 else 'mean-reverting'}); "
              f"strongest hour {p['hour']:02d}:00 UTC {p['hour_dir']} (t {p['hour_t']:+.1f}); "
              f"Asian breakout follow-through {p['asia_follow']:.0f}% of {p['asia_days']} days")
        rows = []
        for name, ts in V.items():
            tr, ho = [t for t in ts if t.t < cut], [t for t in ts if t.t >= cut]
            s1, s2 = st(tr), st(ho)
            rows.append((name, s1, s2, ts, ho))
            print(f"  {name:40s} train n {s1['n']:3d} exp {s1['exp']:+.3f}R t {s1['t']:+.2f} | holdout n {s2['n']:3d} exp {s2['exp']:+.3f}R win {s2['win']:3.0f}%")
        cands = [x for x in rows if x[1]["n"] >= 20]
        if not cands:
            summary.append((inst, None)); continue
        name, s1, s2, ts, ho = max(cands, key=lambda x: x[1]["t"])
        th = [a + (b - a) * f for f in (0, 1 / 3, 2 / 3, 1.0001)]
        thirds = [st([t for t in ts if th[k] <= t.t < th[k + 1]])["exp"] for k in range(3)]
        p_luck = luck(ho)
        ok = s1["t"] > 1 and s2["n"] >= 12 and s2["exp"] > 0.10 and p_luck < 0.10 and all(x > 0 for x in thirds if not np.isnan(x))
        print(f"  -> chosen on train: {name}: holdout n {s2['n']} exp {s2['exp']:+.3f}R win {s2['win']:.0f}% DD {s2.get('dd', 0):.1f}R; "
              f"thirds {' / '.join('{:+.2f}'.format(x) for x in thirds)}; luck {p_luck * 100:.0f}% -> {'PASS' if ok else 'fail'}")
        summary.append((inst, (name, s1, s2, thirds, p_luck, ok)))
        pd.DataFrame([{"t": t.t, "d": t.d, "r": t.r, "reason": t.reason, "variant": n} for n, _, _, tts, _ in rows for t in tts]) \
            .to_csv(E.OUT / f"day_study_{inst.replace('/', '')}.csv", index=False)

    print("\nPATTERNS")
    for inst, p in pat_rows:
        print(f"  {inst:9s} H1 autocorr {p['ac1']:+.3f}  strongest hour {p['hour']:02d}:00 {p['hour_dir']:4s} t {p['hour_t']:+.1f}  Asian breakout follow-through {p['asia_follow']:.0f}%")
    print("\nSUMMARY (variant chosen on train, judged on the holdout)")
    for inst, x in summary:
        if x is None:
            print(f"  {inst:9s} no variant with 20 train trades"); continue
        name, s1, s2, thirds, p, ok = x
        print(f"  {'PASS' if ok else 'fail'}  {inst:9s} {name:40s} train {s1['exp']:+.3f}R ({s1['n']}) t {s1['t']:+.1f}  "
              f"holdout {s2['exp']:+.3f}R ({s2['n']}, win {s2['win']:.0f}%)  thirds {' / '.join('{:+.2f}'.format(v) for v in thirds)}  luck {p * 100:.0f}%")

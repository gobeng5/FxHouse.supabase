"""FX Strategy Playbook (six pairs): backtest, then forward test on untouched months.

Rules are the playbook's. Shared mechanics:
  * Signals at the close of an H1 bar; entry at the next bar's open + half the spread.
  * Exits resolved on H1 bars from the entry bar on. Stop and target inside one bar = stop.
    A bar opening past the stop fills at the open. Stops pay half a spread of slippage
    on top of the half spread every exit pays. Management exits (z-score, ADX, re-entry
    into the range, Donchian trail) are decided at a bar close and fill at the next open.
  * Breakeven: once a bar reaches +1R, the stop moves to the entry from the NEXT bar.
  * One open trade per pair. 4H bars are built from H1 (UTC 00/04/08/...).
  * News: no entry in the hour before US CPI, NFP or FOMC where the pair lists them
    (only US dates are available; ECB/BoJ/BoE/RBA/RBNZ/China dates are not modelled).
  * Not modelled: swap, the cross-pair caps (two yen trades, AUD/NZD same direction),
    Japanese official warnings and "near multi-year highs" sizing.

Train / forward: the first 72% of each pair's history (~8.5 months) is the backtest,
where each pair's target is chosen by expectancy; the last 28% (~3.5 months) is the
forward test, traded with that target unchanged.

Run:  .venv\\Scripts\\python fx_playbook.py
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

import engine as E
import news as N

SPREAD = {"EUR/JPY": 0.015, "USD/JPY": 0.010, "GBP/USD": 0.00012, "AUD/USD": 0.00011,
          "NZD/USD": 0.00015, "EUR/GBP": 0.00012}          # app table where it exists, else estimate
PIP = {"EUR/JPY": 0.01, "USD/JPY": 0.01, "GBP/USD": 0.0001, "AUD/USD": 0.0001, "NZD/USD": 0.0001, "EUR/GBP": 0.0001}
SOURCE = {"USD/JPY": "data.json", "GBP/USD": "data.json", "AUD/USD": "data.json",
          "EUR/JPY": "data-candidates.json", "EUR/GBP": "data-candidates.json"}
TRAIN_FRAC = 0.72
RELEASES = pd.DatetimeIndex(N.release_times_utc())


# ---- data & indicators --------------------------------------------------------------------
def h1(inst: str) -> pd.DataFrame:
    if inst == "NZD/USD":
        return E.load("NZDUSD", "H1", "UTC")
    return E.load_json(SOURCE[inst], inst, "h1", "UTC")


def h4_from(df: pd.DataFrame) -> pd.DataFrame:
    g = df.resample("4h", origin="epoch")
    return pd.DataFrame({"open": g.open.first(), "high": g.high.max(), "low": g.low.min(), "close": g.close.last()}).dropna()


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    up, dn = df.high.diff(), -df.low.diff()
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
    pc = df.close.shift()
    tr = pd.concat([df.high - df.low, (df.high - pc).abs(), (df.low - pc).abs()], axis=1).max(axis=1)
    a = lambda x: pd.Series(x, index=df.index).ewm(alpha=1 / n, adjust=False).mean()
    atr = a(tr)
    pdi, ndi = 100 * a(pdm) / atr, 100 * a(ndm) / atr
    dx = 100 * (pdi - ndi).abs() / (pdi + ndi).replace(0, np.nan)
    out = dx.ewm(alpha=1 / n, adjust=False).mean()
    out.iloc[: 2 * n] = np.nan
    return out


def last_closed_4h(h4: pd.DataFrame, values: pd.Series, h1_index: pd.DatetimeIndex) -> np.ndarray:
    """For each H1 bar, the value of the last 4H bar closed at that H1 bar's close."""
    close_t = h4.index + pd.Timedelta(hours=4)
    pos = close_t.searchsorted(h1_index + pd.Timedelta(hours=1), side="right") - 1
    v = values.to_numpy()
    return np.where(pos >= 0, v[np.clip(pos, 0, None)], np.nan)


# ---- trade simulation ---------------------------------------------------------------------
@dataclass
class Trade:
    inst: str
    d: int
    t_signal: pd.Timestamp
    entry: float
    stop: float
    target: float
    r: float = np.nan
    reason: str = ""
    mfe: float = 0.0
    bars: int = 0
    extra: dict = field(default_factory=dict)


def simulate(df, i_sig, d, stop, target, inst, *, be=True, time_bars=None, manage=None, half_trail=False):
    """Entry at open[i_sig+1]. `stop`/`target` are absolute prices set from the entry fill.
    manage(j, d) -> reason at bar j's close (exit next open). half_trail: half off at the
    target, rest trailed with a 10-bar Donchian exit (breakeven stop)."""
    o, h, l, c = (df[k].to_numpy() for k in ("open", "high", "low", "close"))
    i0 = i_sig + 1
    if i0 >= len(df):
        return None
    hs = SPREAD[inst] / 2
    entry = o[i0] + d * hs
    risk = abs(entry - stop)
    if risk <= 0 or d * (target - entry) <= 0:
        return None
    t = Trade(inst, d, df.index[i_sig], entry, stop, target)
    cur, banked, left, moved = stop, 0.0, 1.0, False
    R = lambda px: d * (px - entry) / risk
    for j in range(i0, len(df)):
        t.bars = j - i0 + 1
        fav = (h[j] if d == 1 else l[j])
        t.mfe = max(t.mfe, R(fav))
        hit_stop = (l[j] <= cur) if d == 1 else (h[j] >= cur)
        hit_tgt = left == 1.0 and ((h[j] >= target) if d == 1 else (l[j] <= target))
        if hit_stop:
            px = (min(cur, o[j]) if d == 1 else max(cur, o[j])) - d * (hs + hs)
            t.r, t.reason = banked + left * R(px), ("breakeven" if moved else "stop") + (" (after half at target)" if left < 1 else "")
            return t
        if hit_tgt:
            if not half_trail:
                t.r, t.reason = R(target - d * hs), "target"
                return t
            banked, left, cur, moved = 0.5 * R(target - d * hs), 0.5, entry, True
        if time_bars and t.bars >= time_bars:
            t.r, t.reason = banked + left * R(c[j] - d * hs), "time"
            return t
        if j + 1 < len(df):
            why = manage(j, d) if manage else None
            if left < 1:   # trailing half: 10-bar Donchian exit
                lo10, hi10 = l[max(0, j - 10):j].min(), h[max(0, j - 10):j].max()
                if (d == 1 and c[j] < lo10) or (d == -1 and c[j] > hi10):
                    why = "trail"
            if why:
                t.r, t.reason = banked + left * R(o[j + 1] - d * hs), why
                return t
        if be and not moved and t.mfe >= 1.0:
            cur, moved = entry, True
    t.r, t.reason = banked + left * R(c[-1] - d * hs), "end of data"
    return t


def news_blocked(ts_entry: pd.Timestamp) -> bool:
    return bool(((RELEASES > ts_entry) & (RELEASES <= ts_entry + pd.Timedelta(minutes=60))).any())


# ---- strategies ---------------------------------------------------------------------------
def donchian(inst, tgt_r=3.0, half_trail=False, us_news=False, intervention=False):
    df = h1(inst)
    h4 = h4_from(df)
    trend = last_closed_4h(h4, h4.close - E.ema(h4.close, 200), df.index)
    atr = E.atr_wilder(df, 14).to_numpy()
    hi20 = df.high.rolling(20).max().shift().to_numpy()
    lo20 = df.low.rolling(20).min().shift().to_numpy()
    c = df.close.to_numpy()
    if intervention:
        d1 = E.load_json(SOURCE[inst], inst, "d1", "UTC")
        d1 = d1[d1.index.dayofweek < 5]
        datr = E.atr_wilder(d1, 14)
        d_close_t = d1.index + pd.Timedelta(days=1)
    out, j = [], 0
    for i in range(len(df) - 1):
        if i < j or np.isnan(trend[i]) or np.isnan(atr[i]) or np.isnan(hi20[i]):
            continue
        d = 1 if c[i] > hi20[i] and trend[i] > 0 else -1 if c[i] < lo20[i] and trend[i] < 0 else 0
        if not d:
            continue
        if us_news and news_blocked(df.index[i + 1]):
            continue
        if intervention and d == 1:
            k = d_close_t.searchsorted(df.index[i] + pd.Timedelta(hours=1), side="right") - 1
            if k >= 5 and c[i] - d1.close.iloc[k - 5] > 3 * datr.iloc[k]:
                continue
        entry = df.open.iloc[i + 1] + d * SPREAD[inst] / 2
        stop = entry - d * 2 * atr[i]
        t = simulate(df, i, d, stop, entry + d * tgt_r * 2 * atr[i], inst, half_trail=half_trail)
        if t:
            out.append(t)
            j = i + 1 + t.bars
    return out, df


def prev_day_breakout(inst="GBP/USD", tgt_r=2.0, atr_stop=False):
    df = h1(inst)
    h4 = h4_from(df)
    trend = last_closed_4h(h4, h4.close - E.ema(h4.close, 200), df.index)
    atr = E.atr_wilder(df, 14).to_numpy()
    day = df.index.normalize()
    daily = df.groupby(day).agg(high=("high", "max"), low=("low", "min"))
    prev_hi = daily.high.shift().reindex(day).to_numpy()
    prev_lo = daily.low.shift().reindex(day).to_numpy()
    c = df.close.to_numpy()
    out, j, taken = [], 0, set()
    for i in range(len(df) - 1):
        close_h = (df.index[i] + pd.Timedelta(hours=1))
        if i < j or np.isnan(trend[i]) or np.isnan(prev_hi[i]) or not (7 <= close_h.hour + close_h.minute / 60 <= 17):
            continue
        d = 1 if c[i] > prev_hi[i] and trend[i] > 0 else -1 if c[i] < prev_lo[i] and trend[i] < 0 else 0
        key = (day[i], d)
        if not d or key in taken or news_blocked(df.index[i + 1]):
            continue
        entry = df.open.iloc[i + 1] + d * SPREAD[inst] / 2
        dist = max(1.5 * atr[i], 30 * PIP[inst]) if atr_stop else 50 * PIP[inst]
        level = prev_hi[i] if d == 1 else prev_lo[i]
        i_entry = i + 1

        def manage(jj, dd, level=level, i_entry=i_entry):
            if jj - i_entry < 3 and dd * (c[jj] - level) < 0:   # back inside within 3 bars
                return "back inside range"
            return None

        t = simulate(df, i, d, entry - d * dist, entry + d * tgt_r * dist, inst, manage=manage)
        if t:
            taken.add(key); out.append(t); j = i + 1 + t.bars
    return out, df


def zscore_mr(inst, look=20, thr=2.0, adx_max=20.0, time_bars=10, min_dist_spreads=0.0,
              session=False, ctx_4h=False, target="mean", us_news=True, manage_exits=True):
    df = h1(inst)
    c, l, h = df.close, df.low.to_numpy(), df.high.to_numpy()
    mean, sd = c.rolling(look).mean(), c.rolling(look).std(ddof=0)
    z = ((c - mean) / sd).to_numpy()
    mean, sd = mean.to_numpy(), sd.to_numpy()
    ax = adx(df).to_numpy()
    atr = E.atr_wilder(df, 14).to_numpy()
    s50 = c.rolling(50).mean().to_numpy()
    flat = np.abs(s50 - np.roll(s50, 10)) < 0.5 * atr
    flat[:60] = False
    if ctx_4h:
        h4 = h4_from(df)
        z4 = (h4.close - h4.close.rolling(look).mean()) / h4.close.rolling(look).std(ddof=0)
        zc = last_closed_4h(h4, z4, df.index)
    cv = c.to_numpy()
    out, j, run_lo, run_hi = [], 0, np.inf, -np.inf
    for i in range(1, len(df) - 1):
        run_lo = min(run_lo, l[i]) if z[i - 1] < -thr or z[i] < -thr else np.inf
        run_hi = max(run_hi, h[i]) if z[i - 1] > thr or z[i] > thr else -np.inf
        if i < j or np.isnan(z[i]) or np.isnan(ax[i]) or np.isnan(atr[i]):
            continue
        d = 1 if z[i - 1] < -thr <= z[i] else -1 if z[i - 1] > thr >= z[i] else 0
        if not d or not (ax[i] < adx_max and flat[i]):
            continue
        close_h = df.index[i] + pd.Timedelta(hours=1)
        if session and not (7 <= close_h.hour + close_h.minute / 60 <= 17):
            continue
        if ctx_4h and not (d * zc[i] < 0):
            continue
        if us_news and news_blocked(df.index[i + 1]):
            continue
        entry = df.open.iloc[i + 1] + d * SPREAD[inst] / 2
        ext = run_lo if d == 1 else run_hi
        stop = min(ext, entry - 1.5 * atr[i]) if d == 1 else max(ext, entry + 1.5 * atr[i])
        m = mean[i]
        tgt = {"half": entry + 0.5 * (m - entry), "mean": m,
               "+0.5sd": m + d * 0.5 * sd[i], "+1sd": m + d * 1.0 * sd[i]}[target]
        if abs(m - entry) < min_dist_spreads * SPREAD[inst]:
            continue

        def manage(jj, dd):
            if (dd == 1 and z[jj] <= -3.5) or (dd == -1 and z[jj] >= 3.5):
                return "z-score 3.5 against"
            if ax[jj] > 25:
                return "ADX > 25"
            return None

        t = simulate(df, i, d, stop, tgt, inst, be=False, time_bars=time_bars, manage=manage if manage_exits else None)
        if t:
            out.append(t); j = i + 1 + t.bars
    return out, df


# ---- reporting ----------------------------------------------------------------------------
def stats(ts):
    r = np.array([t.r for t in ts])
    if not len(r):
        return {"n": 0}
    eq = np.concatenate([[0], r.cumsum()])
    streak = best = 0
    for x in r:
        streak = streak + 1 if x < 0 else 0
        best = max(best, streak)
    g, b = r[r > 0].sum(), -r[r < 0].sum()
    return {"n": len(r), "win": (r > 0).mean() * 100, "hit": np.mean([t.reason == "target" or "half" in t.reason or t.reason == "trail" for t in ts]) * 100,
            "exp": r.mean(), "total": r.sum(), "pf": g / b if b > 0 else np.inf,
            "dd": (np.maximum.accumulate(eq) - eq).max(), "streak": best,
            "mfe": float(np.median([t.mfe for t in ts])), "t": r.mean() / r.std(ddof=1) * np.sqrt(len(r)) if len(r) > 1 and r.std() > 0 else 0}


def fmt(s):
    if not s.get("n"):
        return "n   0"
    pf = "inf" if np.isinf(s["pf"]) else f"{s['pf']:.2f}"
    return (f"n {s['n']:3d}  hit {s['hit']:3.0f}%  win {s['win']:3.0f}%  exp {s['exp']:+.3f}R  total {s['total']:+6.2f}R  "
            f"PF {pf:>4}  DD {s['dd']:4.1f}R  streak {s['streak']:2d}  MFE {s['mfe']:.2f}R  t {s['t']:+.2f}")


def evaluate(name, variants: dict, default):
    """variants: label -> (trades, df). Target chosen on the backtest months by expectancy."""
    _, df = next(iter(variants.values()))
    cut = df.index[0] + (df.index[-1] - df.index[0]) * TRAIN_FRAC
    print(f"\n=== {name}  {df.index[0]:%Y-%m-%d} .. {df.index[-1]:%Y-%m-%d}; forward test from {cut:%Y-%m-%d}")
    tr = {k: [t for t in ts if t.t_signal < cut] for k, (ts, _) in variants.items()}
    fw = {k: [t for t in ts if t.t_signal >= cut] for k, (ts, _) in variants.items()}
    for k in variants:
        print(f"  {k:22s} backtest {fmt(stats(tr[k]))}")
        print(f"  {'':22s} forward  {fmt(stats(fw[k]))}")
    best = max(variants, key=lambda k: (stats(tr[k]).get("exp", -9) if stats(tr[k]).get("n", 0) >= 10 else -9, k == default))
    s_tr, s_fw = stats(tr[best]), stats(fw[best])
    print(f"  -> chosen on backtest: {best}  |  backtest exp {s_tr.get('exp', float('nan')):+.3f}R (n {s_tr.get('n', 0)})"
          f"  |  FORWARD exp {s_fw.get('exp', float('nan')):+.3f}R (n {s_fw.get('n', 0)}, win {s_fw.get('win', 0):.0f}%, total {s_fw.get('total', 0):+.2f}R)")
    rows = [{**vars(t), "variant": k, "part": "backtest" if t.t_signal < cut else "forward"} for k, (ts, _) in variants.items() for t in ts]
    pd.DataFrame(rows).drop(columns="extra").to_csv(E.OUT / f"fx_playbook_{name.split()[0].replace('/', '')}.csv", index=False)
    return name, best, s_tr, s_fw


if __name__ == "__main__":
    E.OUT.mkdir(exist_ok=True)
    res = []
    for inst, kw in (("EUR/JPY", {}), ("USD/JPY", {"us_news": True, "intervention": True})):
        v = {f"{r}R": donchian(inst, r, **kw) for r in (2.0, 2.5, 3.0, 4.0, 5.0)}
        v["half at 3R + trail"] = donchian(inst, 3.0, half_trail=True, **kw)
        res.append(evaluate(f"{inst} Donchian breakout", v, "3.0R"))
    v = {f"{r}R (50 pip stop)": prev_day_breakout("GBP/USD", r) for r in (1.5, 2.0, 2.5, 3.0)}
    v["2.0R (1.5 ATR stop)"] = prev_day_breakout("GBP/USD", 2.0, atr_stop=True)
    res.append(evaluate("GBP/USD previous-day breakout", v, "2.0R (50 pip stop)"))
    TG = ("half", "mean", "+0.5sd", "+1sd")
    res.append(evaluate("GBP/USD z-score (AUD/USD rules)", {t: zscore_mr("GBP/USD", target=t) for t in TG}, "mean"))
    res.append(evaluate("AUD/USD z-score", {t: zscore_mr("AUD/USD", target=t) for t in TG}, "mean"))
    res.append(evaluate("NZD/USD z-score", {t: zscore_mr("NZD/USD", thr=2.5, min_dist_spreads=3, target=t) for t in TG}, "mean"))
    res.append(evaluate("EUR/GBP z-score", {t: zscore_mr("EUR/GBP", look=30, adx_max=22, time_bars=12, min_dist_spreads=4,
                                                          session=True, ctx_4h=True, target=t, us_news=False) for t in TG}, "mean"))
    print("\nSUMMARY (target chosen on the backtest months; forward = untouched last ~3.5 months)")
    for name, best, a, b in res:
        print(f"  {name:34s} {best:22s} backtest {a.get('exp', float('nan')):+.3f}R (n {a.get('n', 0):3d})   forward {b.get('exp', float('nan')):+.3f}R (n {b.get('n', 0):3d})")

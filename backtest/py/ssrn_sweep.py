"""SSRN strategy sweep (doc of 30 Oct 2026, @Fred): backtest of the top five + #5b.

Protocol (from the doc):
  * Paper defaults frozen; one full-period run recorded before any tuning.
  * Signals at a bar close, fill at the NEXT bar's open. Never at the signal bar's close.
  * Resting stops fill at the stop or the bar's open, whichever is worse, plus one extra
    spread of slippage. Half the spread against us on every entry and exit.
  * Random-entry benchmark: 1,000 runs, same entry times/exits/stops, random direction.
    Keep only if the strategy beats the 95th percentile.
  * Walk-forward: 3 months in-sample -> next month out-of-sample, rolling monthly; one
    parameter tuned on a 3-value grid (default and +-20%).
  * Report: trades, win rate, R:R, expectancy (R), net Sharpe, max DD, top-5 share of P&L.
  * Pass: OOS Sharpe > 0.5, >= 30 trades (pooled for slow strategies), holds at +-20%,
    beats the random 95th percentile.

Not modelled (no data): spread by hour of day, swap/financing, session VWAP volume
(Deriv has no volume; VWAP = running mean of typical price).

Run:  .venv\\Scripts\\python ssrn_sweep.py
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, time, timedelta

import numpy as np
import pandas as pd

import engine as E
import news as N

ET = "America/New_York"
LIVE = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "GBP/JPY", "XAU/USD"]
CAND = ["US100", "BTC/USD", "XAG/USD", "EUR/JPY", "EUR/GBP", "NZD/JPY"]
SOURCES = {**{k: "data.json" for k in LIVE}, **{k: "data-candidates.json" for k in CAND}}
ALL12 = LIVE + CAND
FX8 = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "GBP/JPY", "EUR/JPY", "EUR/GBP", "NZD/JPY"]

# Full spread per instrument (price units). BTC: 0.05% of price per side (spread + fees).
SPREAD = {
    "NAS100": 1.5, "US100": 1.5, "XAG/USD": 0.03, "EUR/USD": 0.00010, "GBP/USD": 0.00015,
    "AUD/USD": 0.00011, "USD/JPY": 0.010, "GBP/JPY": 0.025, "XAU/USD": 0.30,   # app SPREAD_TABLE
    "EUR/JPY": 0.015, "EUR/GBP": 0.00012, "NZD/JPY": 0.020,                    # estimates
}


def costs(inst: str, price: float) -> tuple[float, float]:
    """(half spread, stop slippage = one full spread)."""
    if inst == "BTC/USD":
        hs = 0.0005 * price
        return hs, 2 * hs
    return SPREAD[inst] / 2, SPREAD[inst]


class Bars:
    def __init__(self, df: pd.DataFrame):
        self.df, self.idx = df, df.index
        self.o, self.h, self.l, self.c = (df[k].to_numpy() for k in ("open", "high", "low", "close"))
        self.n = len(df)


@dataclass
class Tr:
    inst: str
    d: int
    i0: int
    ie: int
    ekind: str           # exit at bar ie 'open' or 'close'
    t0: str
    te: str
    entry: float
    stop: float
    exit: float
    reason: str
    r: float
    ret: float           # net fractional return
    mirror_r: float = np.nan
    mirror_ret: float = np.nan
    weight: float = 1.0  # #5b portfolio weight
    day: str = ""


def sim(B: Bars, inst: str, i0: int, d: int, stop: float, last_i: int, decide=None, force=None) -> Tr | None:
    """Fill at open[i0]; walk bars to last_i. decide(j, d) at bar j's close -> reason to exit at open j+1."""
    hs, slip = costs(inst, B.o[i0])
    entry = B.o[i0] + d * hs
    if d * (entry - stop) <= 0:
        return None
    risk = abs(entry - stop)

    def mk(j, px, why, kind):
        return Tr(inst, d, i0, j, kind, str(B.idx[i0]), str(B.idx[j]), entry, stop, px, why,
                  d * (px - entry) / risk, d * (px - entry) / entry)

    for j in range(i0, last_i + 1):
        if force is not None and force[1] == "open" and j == force[0]:
            return mk(j, B.o[j] - d * hs, "forced", "open")
        if (d == 1 and B.l[j] <= stop) or (d == -1 and B.h[j] >= stop):
            px = min(stop, B.o[j]) if d == 1 else max(stop, B.o[j])
            return mk(j, px - d * (hs + slip), "stop", "close")
        if force is not None and force[1] == "close" and j == force[0]:
            return mk(j, B.c[j] - d * hs, "forced", "close")
        if j == last_i:
            return mk(j, B.c[j] - d * hs, "time" if last_i < B.n - 1 else "end of data", "close")
        if decide is not None:
            why = decide(j, d)
            if why:
                return mk(j + 1, B.o[j + 1] - d * hs, why, "open")
    return None


def with_mirror(B: Bars, t: Tr | None) -> Tr | None:
    """Benchmark twin: opposite direction, same entry bar, same stop distance, same exit time."""
    if t is None:
        return None
    dist = abs(B.o[t.i0] - t.stop)
    m = sim(B, t.inst, t.i0, -t.d, B.o[t.i0] + t.d * dist, t.ie, force=(t.ie, t.ekind))
    t.mirror_r, t.mirror_ret = (m.r, m.ret) if m else (0.0, 0.0)
    return t


# ---- data helpers -----------------------------------------------------------------------
_cache: dict = {}


def h1(inst: str) -> Bars:
    if inst not in _cache:
        _cache[inst] = Bars(E.load_json(SOURCES[inst], inst, "h1", ET))
    return _cache[inst]


class Daily:
    """17:00 ET trading days built from H1 bars."""
    def __init__(self, B: Bars):
        key = np.array([(t + timedelta(hours=7)).date() for t in B.idx])
        _, first = np.unique(key, return_index=True)
        bounds = list(first) + [B.n]
        self.last = np.array([bounds[k + 1] - 1 for k in range(len(first))])
        self.days = key[first]
        self.C = B.c[self.last]
        self.H = np.array([B.h[bounds[k]:bounds[k + 1]].max() for k in range(len(first))])
        self.L = np.array([B.l[bounds[k]:bounds[k + 1]].min() for k in range(len(first))])
        self.of_bar = np.repeat(np.arange(len(first)), np.diff(bounds))
        self.is_last = np.zeros(B.n, bool); self.is_last[self.last] = True
        df = pd.DataFrame({"high": self.H, "low": self.L, "close": self.C})
        self.atr = E.atr_wilder(df, 14).to_numpy()

    def completed(self, j: int) -> int:
        """Index of the last daily bar fully closed at bar j's close."""
        k = self.of_bar[j]
        return k if self.is_last[j] else k - 1


def at_hour(B: Bars) -> dict:
    return {(t.date(), t.hour): i for i, t in enumerate(B.idx) if t.minute == 0}


# ---- metrics ----------------------------------------------------------------------------
def metrics(vals, dates, span) -> dict:
    v = np.asarray(vals, float)
    if len(v) == 0:
        return {"n": 0}
    days = pd.bdate_range(*span)
    daily = pd.Series(v, index=pd.to_datetime(list(dates))).groupby(level=0).sum().reindex(days, fill_value=0.0)
    sd = daily.std()
    eq = np.concatenate([[0], np.cumsum(v)])
    w, l = v[v > 0], v[v < 0]
    tot = v.sum()
    return {
        "n": len(v), "win": (v > 0).mean() * 100,
        "rr": (w.mean() / -l.mean()) if len(w) and len(l) else np.nan,
        "exp": v.mean(), "total": tot,
        "sharpe": daily.mean() / sd * np.sqrt(252) if sd > 0 else 0.0,
        "mdd": (np.maximum.accumulate(eq) - eq).max(),
        "top5": np.sort(v)[::-1][:5].sum() / tot * 100 if tot > 0 else np.nan,
    }


def fmt(m: dict, unit="R") -> str:
    if not m.get("n"):
        return "no trades"
    t5 = f"{m['top5']:.0f}%" if not np.isnan(m["top5"]) else "n/a"
    return (f"n {m['n']:4d}  win {m['win']:4.1f}%  R:R {m['rr']:.2f}  exp {m['exp']:+.3f}{unit}  "
            f"total {m['total']:+7.2f}{unit}  Sharpe {m['sharpe']:+.2f}  MDD {m['mdd']:.1f}{unit}  top5 {t5}")


def benchmark(a, b, actual, sims=1000, seed=7):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) == 0:
        return np.nan, np.nan
    pick = np.random.default_rng(seed).random((sims, len(a))) < 0.5
    tot = np.where(pick, a, b).sum(axis=1)
    return float(np.percentile(tot, 95)), float((tot >= actual).mean())


def walk_forward(runs: dict, default, span):
    """runs: param -> list of (date, value). 3 months choose (best total), next month trade."""
    months = pd.period_range(pd.Timestamp(span[0]), pd.Timestamp(span[1]), freq="M")
    oos, picks = [], []
    for m in range(len(months) - 3):
        ins, out = set(months[m:m + 3]), months[m + 3]
        score = {p: sum(v for d, v in rows if pd.Period(d, "M") in ins) for p, rows in runs.items()}
        best = max(runs, key=lambda p: (round(score[p], 9), p == default))
        picks.append(best)
        oos += [(d, v) for d, v in runs[best] if pd.Period(d, "M") == out]
    return oos, picks


# ---- strategies -------------------------------------------------------------------------
def nasdaq_sessions(B: Bars):
    """Regular sessions (09:30-16:00 ET) from the NAS100 M5 file, half days excluded."""
    out = []
    idx = B.idx
    dates, tms = idx.date, idx.time
    pos = pd.Series(np.arange(B.n)).groupby(dates)
    for day, ix in pos:
        if day in N.NYSE_HALF_DAY or day in N.NYSE_CLOSED or day.weekday() >= 5:
            continue
        ix = ix.to_numpy()
        tm = {tms[i]: i for i in ix}
        need = [time(9, 30)] + [time(h, 55) for h in range(9, 16)] + [time(15, 0)]
        if any(x not in tm for x in need):
            continue
        rth = np.array([i for i in ix if time(9, 30) <= tms[i] <= time(15, 55)])
        tp = (B.h[rth] + B.l[rth] + B.c[rth]) / 3
        out.append({
            "day": day, "i930": tm[time(9, 30)], "dec": {h: tm[time(h - 1, 55)] for h in range(10, 17)},
            "ch": {h: B.c[tm[time(h - 1, 55)]] for h in range(10, 17)},
            "i1500": tm[time(15, 0)], "last": tm[time(15, 55)],
            "rng": B.h[rth].max() - B.l[rth].min(),
            "lastrng": B.h[tm[time(15, 0)]:tm[time(15, 55)] + 1].max() - B.l[tm[time(15, 0)]:tm[time(15, 55)] + 1].min(),
            "vwap": dict(zip(rth, np.cumsum(tp) / np.arange(1, len(rth) + 1))),
        })
    return out


_m5 = {}


def m5() -> Bars:
    if "B" not in _m5:
        _m5["B"] = Bars(E.load("NAS100", "M5", ET))
        _m5["S"] = nasdaq_sessions(_m5["B"])
    return _m5["B"]


def s1_noise(look=14):
    """#1 Nasdaq noise-area momentum (Zarattini, Aziz & Barbon 2024)."""
    B, S, inst, trades = m5(), _m5["S"], "NAS100", []
    for s in range(max(look, 14), len(S)):
        x, prev = S[s], S[s - 1]
        O, pc = B.o[x["i930"]], prev["ch"][16]
        bands = {}
        for h in range(10, 16):
            sig = np.mean([abs(S[k]["ch"][h] / B.o[S[k]["i930"]] - 1) for k in range(s - look, s)])
            bands[h] = (max(O, pc) * (1 + sig), min(O, pc) * (1 - sig))
        adr = np.mean([S[k]["rng"] for k in range(s - 14, s)])
        dec, last, vw = x["dec"], x["last"], x["vwap"]
        rev = {dec[h]: h for h in range(10, 16)}

        def decide(j, d, rev=rev, bands=bands, vw=vw):
            h = rev.get(j)
            if h is None:
                return None
            U, L = bands[h]
            c = B.c[j]
            if d == 1:
                return "reverse" if c < L else "trail" if c < max(U, vw[j]) else None
            return "reverse" if c > U else "trail" if c > min(L, vw[j]) else None

        min_j, nxt = 0, None
        while True:
            if nxt is None:
                for h in range(10, 16):
                    j = dec[h]
                    if j < min_j:
                        continue
                    U, L = bands[h]
                    if B.c[j] > U: nxt = (j + 1, 1); break
                    if B.c[j] < L: nxt = (j + 1, -1); break
                if nxt is None:
                    break
            i0, d = nxt
            nxt = None
            t = with_mirror(B, sim(B, inst, i0, d, B.o[i0] - d * adr, last, decide))
            if t is None:
                break
            t.day = str(x["day"]); trades.append(t)
            if t.reason == "reverse":
                nxt = (t.ie, -d)
            elif t.reason == "time":
                break
            else:
                min_j = t.ie
    return trades


def s2_final_hour(mult=1.5, vol_filter=True):
    """#2 final-hour intraday momentum (Gao, Han, Li & Zhou 2018)."""
    B, S, inst, trades = m5(), _m5["S"], "NAS100", []
    rets = np.array([np.nan] + [S[k]["ch"][16] / S[k - 1]["ch"][16] - 1 for k in range(1, len(S))])
    vol = pd.Series(rets).rolling(20).std().to_numpy()      # vol[k] uses returns through day k
    for s in range(21, len(S)):
        x = S[s]
        v_y = vol[s - 1]
        hist = vol[max(0, s - 253):s - 1]
        hist = hist[~np.isnan(hist)]
        if vol_filter and (len(hist) < 60 or not v_y > np.median(hist)):
            continue
        r = x["ch"][15] / S[s - 1]["ch"][16] - 1
        if r == 0:
            continue
        d = 1 if r > 0 else -1
        dist = mult * np.mean([S[k]["lastrng"] for k in range(s - 20, s)])
        i0 = x["i1500"]
        t = with_mirror(B, sim(B, inst, i0, d, B.o[i0] - d * dist, x["last"]))
        if t:
            t.day = str(x["day"]); trades.append(t)
    return trades


def composite(C: np.ndarray) -> np.ndarray:
    out = np.zeros((3, len(C))); out[:] = np.nan
    for r, Nn in enumerate((10, 20, 40)):
        half, s = Nn // 2, 0
        for k in range(Nn - 1, len(C)):
            hiN, loN = C[k] >= C[k - Nn + 1:k + 1].max(), C[k] <= C[k - Nn + 1:k + 1].min()
            hiH, loH = C[k] >= C[k - half + 1:k + 1].max(), C[k] <= C[k - half + 1:k + 1].min()
            if s == 1 and loH: s = 0
            if s == -1 and hiH: s = 0
            if hiN: s = 1
            elif loN: s = -1
            out[r, k] = s
    return out.mean(axis=0)


def s3_trend(mult=3.0, insts=ALL12):
    """#3 multi-horizon trend, 10/20/40-day Donchian composite, 3 x ATR stops."""
    trades = []
    TH = 2 / 3 - 1e-9
    for inst in insts:
        B = h1(inst); D = Daily(B)
        comp = composite(D.C)
        min_bar = 0
        for k in range(1, len(D.C)):
            if np.isnan(comp[k - 1]) or np.isnan(D.atr[k]):
                continue
            d = 1 if comp[k] >= TH and comp[k - 1] < TH else -1 if comp[k] <= -TH and comp[k - 1] > -TH else 0
            i0 = D.last[k] + 1
            if not d or i0 >= B.n or i0 < min_bar:
                continue
            best = [B.o[i0]]

            def decide(j, d, best=best, D=D, comp=comp):
                best[0] = max(best[0], B.c[j]) if d == 1 else min(best[0], B.c[j])
                a = D.atr[D.completed(j)]
                if d * (B.c[j] - best[0]) < -mult * a:
                    return "trail"
                if D.is_last[j] and d * comp[D.of_bar[j]] <= 0:
                    return "trend"
                return None

            t = with_mirror(B, sim(B, inst, i0, d, B.o[i0] - d * mult * D.atr[k], B.n - 1, decide))
            if t:
                t.day = str(B.idx[i0].date()); trades.append(t)
                min_bar = t.ie if t.ekind == "open" else t.ie + 1
    return trades


def s3_btc_10day(mult=3.0):
    """#3 BTC variant (Padysak & Vojtko): long when the daily close is the 10-day high; 3 x ATR trail."""
    inst, trades = "BTC/USD", []
    B = h1(inst); D = Daily(B)
    min_bar = 0
    for k in range(9, len(D.C)):
        i0 = D.last[k] + 1
        if np.isnan(D.atr[k]) or i0 >= B.n or i0 < min_bar or D.C[k] < D.C[k - 9:k + 1].max():
            continue
        best = [B.o[i0]]

        def decide(j, d, best=best, D=D):
            best[0] = max(best[0], B.c[j])
            return "trail" if B.c[j] < best[0] - mult * D.atr[D.completed(j)] else None

        t = with_mirror(B, sim(B, inst, i0, 1, B.o[i0] - mult * D.atr[k], B.n - 1, decide))
        if t:
            t.day = str(B.idx[i0].date()); trades.append(t)
            min_bar = t.ie if t.ekind == "open" else t.ie + 1
    return trades


def s4_usd_tod(mult=1.0, skip_news=True, overnight=False):
    """#4 USD time-of-day (Krohn, Mueller & Whelan): long EUR/USD, GBP/USD, USD/JPY 09:00-17:00 ET."""
    trades = []
    for inst in ("EUR/USD", "GBP/USD", "USD/JPY"):
        B = h1(inst); D = Daily(B); H = at_hour(B)
        for day in sorted({t.date() for t in B.idx}):
            if day.weekday() >= 5 or (skip_news and N.news_day(day)):
                continue
            if not overnight:
                i0, last, d = H.get((day, 9)), H.get((day, 16)), 1
            else:
                if day.weekday() == 4:
                    continue
                i0, last, d = H.get((day, 17)), H.get((day + timedelta(days=1), 8)), -1
            if i0 is None or last is None or last <= i0 or H.get((day, 8)) is None and not overnight:
                continue
            a = D.atr[D.of_bar[i0] - 1]
            if np.isnan(a):
                continue
            t = with_mirror(B, sim(B, inst, i0, d, B.o[i0] - d * mult * a, last))
            if t:
                t.day = str(day); trades.append(t)
    return trades


def s5_carry(pct=80, insts=("NZD/JPY", "GBP/JPY", "EUR/JPY")):
    """#5 carry with trend + volatility filter; long the higher yielder (JPY is the funder)."""
    trades = []
    for inst in insts:
        B = h1(inst); D = Daily(B)
        lr = np.diff(np.log(D.C), prepend=np.nan)
        vol = pd.Series(lr).rolling(20).std().to_numpy()
        thr = np.full(len(vol), np.nan)
        for k in range(len(vol)):
            h = vol[max(0, k - 251):k + 1]
            h = h[~np.isnan(h)]
            if len(h) >= 60:
                thr[k] = np.percentile(h, pct)

        def ok(j, D=D, vol=vol, thr=thr):
            kd, kc = D.of_bar[j], D.completed(j)
            if kd < 60 or kc < 0 or np.isnan(thr[kc]):
                return False
            return B.c[j] / D.C[kd - 60] - 1 > 0 and vol[kc] < thr[kc]

        j = 0
        while j < B.n - 1:
            if not ok(j):
                j += 1; continue
            i0 = j + 1
            a = D.atr[D.completed(j)]
            t = with_mirror(B, sim(B, inst, i0, 1, B.o[i0] - 3 * a, B.n - 1,
                                   lambda jj, d, ok=ok: None if ok(jj) else "filter"))
            if t is None:
                j += 1; continue
            t.day = str(B.idx[i0].date()); trades.append(t)
            j = t.ie if t.ekind == "close" else t.ie - 1
            j += 1 if t.ekind == "close" else 0
    return trades


def s5b_reversal(mult=1.0, disp_filter=False):
    """#5b overnight-intraday reversal across the 8 FX pairs (Liu et al.). One 'trade' = one day."""
    bars = {i: h1(i) for i in FX8}
    dly = {i: Daily(bars[i]) for i in FX8}
    hours = {i: at_hour(bars[i]) for i in FX8}
    days = sorted(set.intersection(*[{t.date() for t in bars[i].idx} for i in FX8]))
    rows, disp_hist = [], []
    for day in days:
        if day.weekday() >= 5:
            continue
        r, legs = {}, {}
        for i in FX8:
            H = hours[i]
            prev = next((H[(day - timedelta(days=k), 16)] for k in (1, 2, 3)
                         if (day - timedelta(days=k), 16) in H), None)
            ix = [H.get((day, 8)), H.get((day, 9)), H.get((day, 15))]
            if prev is None or None in ix:
                break
            x = bars[i].c[ix[0]] / bars[i].c[prev] - 1
            r[i] = -x if i == "USD/JPY" else x
            legs[i] = ix
        else:
            rv = np.array([r[i] for i in FX8])
            disp = rv.std()
            skip = disp_filter and (len(disp_hist) < 20 or disp < np.median(disp_hist[-20:]))
            disp_hist.append(disp)
            if skip:
                continue
            w = -(rv - rv.mean())
            if np.abs(w).sum() == 0:
                continue
            w = w / np.abs(w).sum()
            for i, wi in zip(FX8, w):
                if wi == 0:
                    continue
                B, D = bars[i], dly[i]
                _, i0, last = legs[i]
                d = int(np.sign(wi)) * (-1 if i == "USD/JPY" else 1)
                a = D.atr[D.of_bar[i0] - 1]
                if np.isnan(a):
                    continue
                t = with_mirror(B, sim(B, i, i0, d, B.o[i0] - d * mult * a, last))
                if t:
                    t.weight, t.day = abs(wi), str(day); rows.append(t)
    return rows


# ---- runner -----------------------------------------------------------------------------
def span_of(trades):
    ds = sorted(t.day for t in trades)
    return (ds[0], ds[-1]) if ds else ("2025-11-01", "2026-10-28")


def evaluate(name, runs: dict, default, unit="R", portfolio=False, per_inst=False):
    """runs: param -> trades. Prints full-period, benchmark, +-20%, walk-forward, verdict."""
    T = runs[default]
    span = span_of([t for ts in runs.values() for t in ts])

    def series(ts):
        if not portfolio:
            return [(t.day, t.r) for t in ts]
        s = pd.DataFrame({"day": [t.day for t in ts], "v": [t.weight * t.ret * 1e4 for t in ts]})
        return list(s.groupby("day").v.sum().items())

    def m_of(ts):
        rows = series(ts)
        return metrics([v for _, v in rows], [d for d, _ in rows], span)

    full = m_of(T)
    print(f"\n=== {name} ===  ({span[0]} to {span[1]})")
    print(f"  full period, paper default ({default}):  {fmt(full, unit)}")
    if portfolio:
        pos = metrics([t.r for t in T], [t.day for t in T], span)
        print(f"  per position (R):                  {fmt(pos)}")
    if per_inst:
        for inst in sorted({t.inst for t in T}):
            ts = [t for t in T if t.inst == inst]
            print(f"    {inst:8s} n {len(ts):3d}  exp {np.mean([t.r for t in ts]):+.3f}R  total {sum(t.r for t in ts):+6.2f}R")
    # benchmark
    if portfolio:
        a = [t.weight * t.ret * 1e4 for t in T]; b = [t.weight * t.mirror_ret * 1e4 for t in T]
    else:
        a = [t.r for t in T]; b = [t.mirror_r for t in T]
    p95, share = benchmark(a, b, sum(a))
    beats = full.get("n", 0) > 0 and sum(a) > p95
    print(f"  random-direction benchmark: 95th pct total {p95:+.2f}{unit}; strategy {sum(a):+.2f}{unit} "
          f"(beaten by {share * 100:.1f}% of 1,000 random runs) -> {'BEATS' if beats else 'does not beat'}")
    # +-20 %
    ms = {p: m_of(ts) for p, ts in runs.items()}
    for p, m in ms.items():
        print(f"    param {str(p):6s}: {fmt(m, unit)}")
    others = [m for p, m in ms.items() if p != default]
    robust = full.get("n", 0) > 0 and all(m.get("n") and m["exp"] > 0 and m["sharpe"] >= 0.5 * full["sharpe"] > 0
                                           for m in others)
    # walk-forward
    oos, picks = walk_forward({p: series(ts) for p, ts in runs.items()}, default, span)
    wf = metrics([v for _, v in oos], [d for d, _ in oos], (oos[0][0], span[1]) if oos else span)
    print(f"  walk-forward OOS ({len(picks)} folds, picks {picks}):  {fmt(wf, unit)}")
    n_ok = wf.get("n", 0) >= 30
    sh_ok = wf.get("n", 0) > 0 and wf["sharpe"] > 0.5
    checks = [("OOS Sharpe > 0.5", sh_ok), ("OOS trades >= 30", n_ok), ("holds at +-20%", robust),
              ("beats random 95th pct", beats)]
    top5 = full.get("top5")
    flag = " (FLAG: top-5 trades > 50% of P&L)" if top5 is not None and not np.isnan(top5) and top5 > 50 else ""
    print("  verdict: " + ", ".join(f"[{'PASS' if ok else 'FAIL'}] {c}" for c, ok in checks)
          + f"  => {'PASS' if all(ok for _, ok in checks) else 'FAIL'}{flag}")
    pd.DataFrame([asdict(t) for t in T]).to_csv(E.OUT / f"ssrn_{name.split()[0].strip('#')}_trades.csv", index=False)
    return {"name": name, "full": full, "wf": wf, "pass": all(ok for _, ok in checks)}


if __name__ == "__main__":
    E.OUT.mkdir(exist_ok=True)
    out = []
    out.append(evaluate("#1 Nasdaq noise-area momentum (NAS100 M5)", {11: s1_noise(11), 14: s1_noise(14), 17: s1_noise(17)}, 14))
    out.append(evaluate("#2 Final-hour momentum, vol filter (NAS100 M5)",
                        {1.2: s2_final_hour(1.2), 1.5: s2_final_hour(1.5), 1.8: s2_final_hour(1.8)}, 1.5))
    out.append(evaluate("#2b Final-hour momentum, no vol filter",
                        {1.2: s2_final_hour(1.2, False), 1.5: s2_final_hour(1.5, False), 1.8: s2_final_hour(1.8, False)}, 1.5))
    out.append(evaluate("#3 Multi-horizon trend, all 12 pooled", {2.4: s3_trend(2.4), 3.0: s3_trend(3.0), 3.6: s3_trend(3.6)}, 3.0, per_inst=True))
    out.append(evaluate("#3b BTC 10-day-high trend", {2.4: s3_btc_10day(2.4), 3.0: s3_btc_10day(3.0), 3.6: s3_btc_10day(3.6)}, 3.0))
    out.append(evaluate("#4 USD time-of-day, skip news days", {0.8: s4_usd_tod(0.8), 1.0: s4_usd_tod(1.0), 1.2: s4_usd_tod(1.2)}, 1.0, per_inst=True))
    out.append(evaluate("#4b USD time-of-day, all days", {0.8: s4_usd_tod(0.8, False), 1.0: s4_usd_tod(1.0, False), 1.2: s4_usd_tod(1.2, False)}, 1.0, per_inst=True))
    out.append(evaluate("#4c USD overnight leg (reverse, 17:00-09:00)",
                        {0.8: s4_usd_tod(0.8, True, True), 1.0: s4_usd_tod(1.0, True, True), 1.2: s4_usd_tod(1.2, True, True)}, 1.0, per_inst=True))
    out.append(evaluate("#5 Carry + trend + vol filter (JPY crosses)", {64: s5_carry(64), 80: s5_carry(80), 96: s5_carry(96)}, 80, per_inst=True))
    out.append(evaluate("#5b Overnight-intraday reversal, 8 FX (bp/day)",
                        {0.8: s5b_reversal(0.8), 1.0: s5b_reversal(1.0), 1.2: s5b_reversal(1.2)}, 1.0, unit="bp", portfolio=True))
    out.append(evaluate("#5c Reversal + dispersion filter (bp/day)",
                        {0.8: s5b_reversal(0.8, True), 1.0: s5b_reversal(1.0, True), 1.2: s5b_reversal(1.2, True)}, 1.0, unit="bp", portfolio=True))
    print("\nSUMMARY")
    for x in out:
        print(f"  {'PASS' if x['pass'] else 'FAIL'}  {x['name']}")

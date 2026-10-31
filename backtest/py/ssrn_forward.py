"""Forward test of the positive SSRN-sweep results. Rules frozen exactly as in ssrn_sweep.py.

  A) Unseen history before the backtest year: BTC/USD on Binance BTCUSDT H1, Sep 2023 - Oct 2025
     (#3 trend and #3b 10-day high). Forex/gold older history was not available (Dukascopy 503).
  B) Bars that arrived after the backtest data ended (Deriv H1, data/ext/*_deriv_H1.csv), joined
     onto the backtest file so indicators keep their warm-up; only trades entered after the
     backtest end count.
"""
import numpy as np
import pandas as pd

import engine as E
import ssrn_sweep as S

EXT = E.DATA / "ext"
FILE_NAME = {"XAU/USD": "XAUUSD", "EUR/USD": "EURUSD", "AUD/USD": "AUDUSD", "GBP/USD": "GBPUSD",
             "USD/JPY": "USDJPY", "BTC/USD": "BTCUSD"}


def csv_h1(path) -> pd.DataFrame:
    d = pd.read_csv(path, parse_dates=["time_utc"]).set_index("time_utc").sort_index()
    return d[~d.index.duplicated(keep="last")].tz_convert(S.ET)[["open", "high", "low", "close"]]


def joined(inst) -> tuple[pd.DataFrame, pd.Timestamp]:
    old = E.load_json(S.SOURCES[inst], inst, "h1", S.ET)
    new = csv_h1(EXT / f"{FILE_NAME[inst]}_deriv_H1.csv")
    both = pd.concat([old[old.index < new.index[0]], new])
    return both, old.index[-1]


def show(label, ts, unit="R"):
    m = S.metrics([t.r for t in ts], [t.day for t in ts], S.span_of(ts)) if ts else {"n": 0}
    print(f"  {label:42s} {S.fmt(m, unit)}")
    for t in ts[-12:] if len(ts) <= 12 else []:
        print(f"      {t.t0[:16]}  {'long ' if t.d == 1 else 'short'}  {t.reason:11s} {t.r:+.2f}R")


def part_a():
    print("\nA) BTC/USD on unseen history (Binance BTCUSDT H1, Sep 2023 - Oct 2025)")
    S._cache["BTC/USD"] = S.Bars(csv_h1(EXT / "BTCUSD_binance_H1.csv"))
    tr = S.s3_trend(3.0, ["BTC/USD"])
    show("#3 trend (10/20/40 Donchian, 3xATR)", tr)
    a, b = [t.r for t in tr], [t.mirror_r for t in tr]
    p95, share = S.benchmark(a, b, sum(a))
    print(f"      random 95th pct {p95:+.2f}R vs {sum(a):+.2f}R (beaten by {share * 100:.1f}% of random runs)")
    for y in ("2023", "2024", "2025"):
        ys = [t for t in tr if t.day.startswith(y)]
        print(f"      {y}: n {len(ys):2d}  total {sum(t.r for t in ys):+.2f}R")
    tb = S.s3_btc_10day(3.0)
    show("#3b BTC 10-day-high trend", tb)
    a, b = [t.r for t in tb], [t.mirror_r for t in tb]
    p95, share = S.benchmark(a, b, sum(a))
    print(f"      random 95th pct {p95:+.2f}R vs {sum(a):+.2f}R (beaten by {share * 100:.1f}% of random runs)")
    pd.DataFrame([vars(t) for t in tr + tb]).to_csv(E.OUT / "ssrn_forward_btc_history.csv", index=False)
    S._cache.pop("BTC/USD")


def part_b():
    print("\nB) New bars after the backtest data ended (Deriv H1)")
    rows = []
    for inst in ("XAU/USD", "EUR/USD", "BTC/USD", "AUD/USD", "GBP/USD", "USD/JPY"):
        df, cut = joined(inst)
        S._cache[inst] = S.Bars(df)
        print(f"  {inst}: forward window {cut.strftime('%Y-%m-%d %H:%M')} ET .. {df.index[-1].strftime('%Y-%m-%d %H:%M')} ET")
        after = lambda ts: [t for t in ts if pd.Timestamp(t.t0) > cut]
        if inst != "USD/JPY":
            ts = after(S.s3_trend(3.0, [inst])); rows += ts
            show(f"#3 trend {inst}", ts)
        if inst == "BTC/USD":
            ts = after(S.s3_btc_10day(3.0)); rows += ts
            show("#3b BTC 10-day high", ts)
        if inst == "USD/JPY":
            ts = after([t for t in S.s4_usd_tod(1.0, skip_news=False) if t.inst == "USD/JPY"]); rows += ts
            show("#4 USD time-of-day, all days, USD/JPY", ts)
    pd.DataFrame([vars(t) for t in rows]).to_csv(E.OUT / "ssrn_forward_new_bars.csv", index=False)


if __name__ == "__main__":
    part_a()
    part_b()

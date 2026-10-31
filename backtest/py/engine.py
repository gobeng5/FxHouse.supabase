"""Shared backtest engine: data loading, fills, exits, R accounting, summary, chart, verdict.

General rules (fixed):
  * No lookahead: a signal uses only closed candles; exits are checked from the bar after entry.
  * Entry at the signal-candle close plus half the spread against the trader.
  * Stop/target fill at the exact level; time exit at the bar close; half the spread against
    the trader on every exit. A bar that opens beyond the stop fills at the open (worse).
  * Stop and target inside the same candle = loss.
  * Fixed 1% risk; results in R. One trade at a time.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from pathlib import Path

import numpy as np
import pandas as pd

# ---- Costs (editable) -------------------------------------------------------------------
SPREADS = {
    "NAS100": 1.5,          # points
    "BTCUSD": 0.0005,       # 0.05% per side (fraction of price)
    "XAGUSD": 0.03,         # price units
    "EURUSD": 0.00010,      # 1.0 pip
    "GBPUSD": 0.00015,      # 1.5 pips
}
PCT_SPREAD = {"BTCUSD"}     # spreads given as a fraction of price, per side

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "out"


def half_spread(symbol: str, price: float) -> float:
    s = SPREADS[symbol]
    return s * price if symbol in PCT_SPREAD else s / 2


def load(name: str, tf: str = "M5", tz: str = "UTC") -> pd.DataFrame:
    """Candles indexed by OPEN time in `tz`. Off-grid timestamps (feed artefacts) are dropped."""
    d = pd.read_csv(DATA / f"{name}_{tf}.csv", parse_dates=["time_utc"])
    step = {"M1": 60, "M5": 300, "M15": 900, "H1": 3600, "H4": 14400, "D1": 86400}[tf]
    d = d[d.time_utc.dt.floor(f"{step}s") == d.time_utc]
    d = d.drop_duplicates("time_utc").set_index("time_utc").sort_index()
    return d.tz_convert(tz)


_JSON: dict = {}
GRAN = {"m15": 900, "h1": 3600, "h4": 14400, "d1": 86400}


def load_json(file: str, inst: str, tf: str, tz: str = "UTC") -> pd.DataFrame:
    """Candles from backtest/<file> (Deriv epochs = candle OPEN, UTC); off-grid rows dropped."""
    if file not in _JSON:
        import json
        _JSON[file] = json.load(open(ROOT.parent / file, encoding="utf-8"))
    d = pd.DataFrame(_JSON[file][inst][tf])
    d = d[d.epoch % GRAN[tf] == 0].drop_duplicates("epoch").sort_values("epoch")
    d = d[(d.high >= d[["open", "close"]].max(axis=1)) & (d.low <= d[["open", "close"]].min(axis=1))]
    d.index = pd.to_datetime(d.epoch, unit="s", utc=True).dt.tz_convert(tz)
    return d[["open", "high", "low", "close"]]


def ema(s: pd.Series, n: int) -> pd.Series:
    """EMA of closes; NaN until n bars exist (no half-formed values are traded)."""
    e = s.ewm(span=n, adjust=False).mean()
    e.iloc[: n - 1] = np.nan
    return e


def atr_wilder(df: pd.DataFrame, n: int = 14) -> pd.Series:
    pc = df.close.shift()
    tr = pd.concat([df.high - df.low, (df.high - pc).abs(), (df.low - pc).abs()], axis=1).max(axis=1)
    a = tr.ewm(alpha=1 / n, adjust=False).mean()
    a.iloc[:n] = np.nan
    return a


def split_at(index: pd.DatetimeIndex, frac: float = 0.6) -> pd.Timestamp:
    """Backtest = first 60% of the data period; forward test = the last 40%."""
    a, b = index[0].tz_convert("UTC"), index[-1].tz_convert("UTC")
    return a + (b - a) * frac


# ---- Trades -----------------------------------------------------------------------------
@dataclass
class Trade:
    date: str
    direction: str              # long / short
    signal_time: str
    entry: float                # filled (close ± half spread)
    stop: float
    target: float
    exit_time: str = ""
    exit_price: float = np.nan  # net of exit half spread
    exit_reason: str = ""       # stop / target / time / stop+target (loss)
    r: float = np.nan
    risk: float = np.nan
    notes: str = ""
    instrument: str = ""


@dataclass
class Skip:
    date: str
    reason: str


def manage(trade: Trade, bars: pd.DataFrame, hs: float, trend_exit: pd.Series | None = None,
           last_is_time_exit: bool = True) -> Trade:
    """Walk `bars` (strictly after the entry bar, up to and including the time-exit bar).
    `trend_exit` (bool per bar): exit at that bar's close if stop/target were not hit in it.
    `last_is_time_exit` False (swing): a trade still open when data ends closes at the last
    close, labelled 'end of data'."""
    d = 1 if trade.direction == "long" else -1
    risk = abs(trade.entry - trade.stop)
    trade.risk = risk
    for ts, b in bars.iterrows():
        hit_stop = b.low <= trade.stop if d == 1 else b.high >= trade.stop
        hit_tgt = b.high >= trade.target if d == 1 else b.low <= trade.target
        if hit_stop:
            gapped = (b.open < trade.stop) if d == 1 else (b.open > trade.stop)
            px = b.open if gapped else trade.stop
            reason = "stop+target (loss)" if hit_tgt else ("stop (gap)" if gapped else "stop")
            return _close(trade, ts, px - d * hs, reason)
        if hit_tgt:
            return _close(trade, ts, trade.target - d * hs, "target")
        if trend_exit is not None and bool(trend_exit.get(ts, False)):
            return _close(trade, ts, b.close - d * hs, "trend exit")
    if len(bars) == 0:
        trade.exit_reason = "no bars after entry"
        return trade
    ts = bars.index[-1]
    return _close(trade, ts, bars.close.iloc[-1] - d * hs, "time" if last_is_time_exit else "end of data")


def _close(t: Trade, ts, px: float, reason: str) -> Trade:
    d = 1 if t.direction == "long" else -1
    t.exit_time, t.exit_price, t.exit_reason = str(ts), px, reason
    t.r = d * (px - t.entry) / t.risk
    return t


# ---- Reporting --------------------------------------------------------------------------
def longest_streak(rs: np.ndarray) -> int:
    best = cur = 0
    for r in rs:
        cur = cur + 1 if r < 0 else 0
        best = max(best, cur)
    return best


def summarize(trades: list[Trade], day_trade: bool) -> dict:
    df = pd.DataFrame([asdict(t) for t in trades if not np.isnan(t.r)])
    if df.empty:
        return {"trades": 0}
    rs = df.r.to_numpy()
    eq = rs.cumsum()
    dd = float((np.maximum.accumulate(np.concatenate([[0], eq])) - np.concatenate([[0], eq])).max())
    df["month"] = df.date.str[:7]
    s = {
        "trades": len(df),
        "win_rate": float((rs > 0).mean() * 100),
        "expectancy_r": float(rs.mean()),
        "total_r": float(rs.sum()),
        "max_drawdown_r": dd,
        "longest_losing_streak": longest_streak(rs),
        "by_direction": df.groupby("direction").r.agg(["count", "mean", "sum"]).round(3).to_dict("index"),
        "by_month": df.groupby("month").r.agg(["count", "sum"]).round(2).to_dict("index"),
        "by_exit": df.groupby("exit_reason").r.agg(["count", "mean"]).round(3).to_dict("index"),
    }
    if day_trade:
        te = df[df.exit_reason == "time"].r
        s["time_exit_avg_r"] = float(te.mean()) if len(te) else None
        s["time_exits"] = int(len(te))
    return s


def verdict(s: dict, day_trade: bool) -> list[tuple[str, bool, str]]:
    """Pass levels. 'Not from one month/direction' read conservatively:
    total R stays > 0 without the best month, and the weaker direction's total R is > 0."""
    if not s.get("trades"):
        return [("trades", False, "0 trades")]
    need = 100 if day_trade else 50
    months = {k: v["sum"] for k, v in s["by_month"].items()}
    best_m = max(months, key=months.get)
    dirs = {k: v["sum"] for k, v in s["by_direction"].items()}
    weak_dir = min(dirs.values()) if len(dirs) == 2 else float("-inf")
    return [
        ("expectancy > +0.15R", s["expectancy_r"] > 0.15, f"{s['expectancy_r']:+.3f}R"),
        (f"trades >= {need}", s["trades"] >= need, str(s["trades"])),
        ("max drawdown < 10R", s["max_drawdown_r"] < 10, f"{s['max_drawdown_r']:.2f}R"),
        ("profit not from one month", s["total_r"] - months[best_m] > 0,
         f"total {s['total_r']:+.2f}R, without best month {best_m}: {s['total_r'] - months[best_m]:+.2f}R"),
        ("profit not from one direction", weak_dir > 0,
         ", ".join(f"{k} {v:+.2f}R" for k, v in dirs.items())),
    ]


def report(name: str, trades: list[Trade], skips: list[Skip], day_trade: bool, split=None) -> dict:
    """`split` = timestamp: trades with entry before it are the backtest, from it the forward test."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    OUT.mkdir(exist_ok=True)
    rows = [{**asdict(t), "status": "trade"} for t in trades] + \
           [{"date": k.date, "status": "skipped", "notes": k.reason} for k in skips]
    log = pd.DataFrame(rows, columns=list(Trade.__dataclass_fields__) + ["status"]).sort_values("date")
    log.to_csv(OUT / f"{name}_trades.csv", index=False)

    s = summarize(trades, day_trade)
    v = verdict(s, day_trade)
    s["verdict"] = [{"check": c, "pass": p, "value": x} for c, p, x in v]
    s["passed"] = all(p for _, p, _ in v)
    if split is not None:
        cut = pd.Timestamp(split)
        when = lambda t: pd.Timestamp(t.signal_time).tz_convert("UTC")
        for part, sel in (("backtest", lambda t: when(t) < cut), ("forward", lambda t: when(t) >= cut)):
            sub = summarize([t for t in trades if sel(t)], day_trade)
            s[part] = {k: sub.get(k) for k in ("trades", "win_rate", "expectancy_r", "total_r", "max_drawdown_r")}
        s["split"] = str(cut)
    s["skipped_days"] = pd.Series([k.reason.split(":")[0] for k in skips]).value_counts().to_dict()

    rs = [t.r for t in trades if not np.isnan(t.r)]
    if rs:
        fig, ax = plt.subplots(figsize=(10, 4))
        ax.plot(np.concatenate([[0], np.cumsum(rs)]), lw=1.4)
        ax.axhline(0, color="grey", lw=0.6)
        ax.set_title(f"{name}: equity in R ({len(rs)} trades, {sum(rs):+.1f}R)")
        ax.set_xlabel("trade #"); ax.set_ylabel("cumulative R"); ax.grid(alpha=0.3)
        fig.tight_layout(); fig.savefig(OUT / f"{name}_equity.png", dpi=110); plt.close(fig)

    pd.Series(s).to_json(OUT / f"{name}_summary.json", indent=2, default_handler=str)
    return s


def print_summary(name: str, s: dict) -> None:
    print(f"\n===== {name} =====")
    if not s.get("trades"):
        print("no trades"); return
    print(f"trades {s['trades']}  win {s['win_rate']:.1f}%  expectancy {s['expectancy_r']:+.3f}R  "
          f"total {s['total_r']:+.2f}R  maxDD {s['max_drawdown_r']:.2f}R  "
          f"longest losing streak {s['longest_losing_streak']}")
    if "time_exit_avg_r" in s:
        te = s["time_exit_avg_r"]
        print(f"time exits {s['time_exits']}  avg {te:+.3f}R" if te is not None else "time exits 0")
    print("by direction:", s["by_direction"])
    print("by exit:", s["by_exit"])
    print("by month:")
    for m, v in s["by_month"].items():
        print(f"  {m}  n {int(v['count']):3d}  {v['sum']:+.2f}R")
    for part in ("backtest", "forward"):
        if part in s and s[part].get("trades"):
            x = s[part]
            print(f"{part:9s}: n {x['trades']}  win {x['win_rate']:.1f}%  exp {x['expectancy_r']:+.3f}R  "
                  f"total {x['total_r']:+.2f}R  DD {x['max_drawdown_r']:.2f}R")
        elif part in s:
            print(f"{part:9s}: no trades")
    if "split" in s:
        print("forward test starts", s["split"][:10])
    print("skipped days:", s["skipped_days"])
    print("verdict:")
    for x in s["verdict"]:
        print(f"  [{'PASS' if x['pass'] else 'FAIL'}] {x['check']}: {x['value']}")
    print("OVERALL:", "PASS" if s["passed"] else "FAIL")

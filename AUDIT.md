# FxHouse — Open Issues Handoff Audit

Date: 2026-09-16 (UTC) — session checkpoint (see "Session close" at the end)
Scope: production-accurate walk-forward harness (`.backtest/prod.ts`, `.backtest/prodstats.ts`, `.backtest/variants.ts`)
using `.backtest/arbiterModel.ts`, a faithful model of the deployed `public.arbitrate_signal()` RPC,
12-month Deriv history (all 12 instruments, D1/4H/1H).

---

## 1. Day-trade geometry variants — result: no variant helps

Run: 308 signals generated, 42 cancelled by the arbiter's reversal rule, 236 filled and kept.
Swing geometry untouched in all variants (identical rows across variants, as expected).

| Variant | Day-trade rule | n | Win rate | avg R | net R | t |
|---|---|---|---|---|---|---|
| base | live geometry (1.5x ATR1H stop, current ladder) | 90 | 43.3% | **+0.222** | +19.96 | 1.49 |
| A | stop widened to 2.0x ATR1H, same ladder | 90 | 50.0% | +0.183 | +16.43 | 1.45 |
| B | live stop, terminal first target at 0.8R | 92 | 59.8% | +0.067 | +6.20 | 0.73 |
| C | both (2.0x stop + 0.8R target) | 92 | 68.5% | +0.090 | +8.27 | 1.16 |

Conclusion: **none of the three variants beat the current geometry.** Widening the stop raises win rate but shrinks
R per win by more than it saves; the short 0.8R target raises win rate sharply (to 60–69%) while cutting average R
roughly to a third. Nothing was implemented. Same honest-null outcome as the day-trade gate counterfactual.

Note on the baseline: the earlier `-0.202R, n=102` day-trade figure predates the V50 cost-floor stop clamp and used a
separately fetched dataset. On the current code and a freshly refetched 12-month dataset the day baseline is
**+0.222R (n=90)**. The clamp is the main difference; the two numbers are not directly comparable.

## 2. Current production-accurate expectancy

All resolved, filled, non-cancelled signals, current live code:

- n = 221 · win rate 42.1% · **avg R +0.053** · net +11.72R · t = 0.60
- 95% CI on avg R: **−0.120 to +0.226** — statistically indistinguishable from zero.
- Split: day +0.222R (n=90), swing −0.063R (n=131).

Interpretation: the system is not demonstrably profitable or unprofitable at this sample size. Day trades carry all
current positive expectancy; swing is mildly negative. Do not size up on this evidence.

---

## Open issues

### A. Server-side signal-engine lacks the ATR stop clamp — RESOLVED 2026-09-15
Ported verbatim into `generateSignal()` in `supabase/functions/signal-engine/index.ts`: same `costFloorDist =
spreadApplied * 8` for synthetics, same `minStopDist` / `maxStopDist` ATR band, same `clampStopDistance()`; spread and
ATR-percentile computation moved above the stop calculation. Also brings the forex 0.8x ATR4H min and 2x slMult max
bands to the server (parity, not a new rule).
Measured effect on the server path is nil: the server's swing stop is already structural-or-slMult x ATR4H wide, so
spread averages 0.8% of risk there, not the 64.7% seen on client day trades (1.5x ATR1H stops). The client-side gain
(V50 spread/risk 64.7% -> 12.4%, V50 avg R −0.181 -> +0.043) stands; the port prevents future drift rather than fixing
a server pathology. Server generates swing only.

### B. Server-side signal-engine has no arbiter — RESOLVED 2026-09-16 (see item L)
No reference to `arbitrateSignal`, conflict, or correlation exists anywhere in the edge function. The one-setup-per-pair
rule, the >=5-confidence-point reversal replacement rule, and correlation blocking apply **only to client-generated
signals**. Server cron-generated signals can duplicate and conflict with client signals and with each other. The arbiter
logic would need to be duplicated in Deno (it cannot import from `src/`), or moved into shared SQL/RPC.

### C. Confidence scoring has no measured predictive power — OPEN, not reworked
Across the full 12-month backtest and live August data, win rate and avg R are flat-to-inverted across confidence bands
(90–100 was the worst live band in August: 33.3%, −4.17R). The day-trade formula was de-duplicated (MACD redundancy
removed, quality+proximity zone requirement added, capped at 95/12) and `confluence_breakdown`,
`confluence_score_total`, `confluence_score_max` are now persisted per signal — but no reweighting has been done, and
there is not yet enough post-fix data to re-measure. Next step is a component-level regression against realized R once
a few hundred post-fix signals accumulate, not another a-priori reweight.

### D. Unordered `.limit(50)` on pending-signal outcome checks — RESOLVED 2026-09-15
The pending query now orders by `generated_at` ascending and pages 200 rows at a time until exhausted, capped at
25 pages / 5,000 rows as a runaway guard. Older pending signals can no longer be starved out of resolution.

### E. Two overlapping outcome-check cron schedules — RESOLVED 2026-09-15
`signal-engine-outcome-check` (jobid 4, `*/30 * * * *`) unscheduled. Current `cron.job`:

| jobid | name | schedule |
|---|---|---|
| 2 | signal-outcomes-check | `*/5 * * * *` |
| 5 | signal-engine-1h-analysis | `5 * * * *` |

Nothing else was touched; outcome resolution runs once every 5 minutes, generation at XX:05.

### F. `daily_performance` counter undercounts on multi-instrument runs — OPEN
In the generation loop, `signals_generated` is written as `(dailyPerf?.signals_generated || 0) + 1` (lines ~1453 and
~1504) using a `dailyPerf` snapshot read once before the loop. Across a multi-instrument run every insert computes the
same base value, so N signals in one run advance the counter by 1, not N. Consequence: the `max_trades_per_day` guard
(line ~1378) under-throttles. Fix: atomic increment in SQL (`signals_generated = daily_performance.signals_generated + 1`
via upsert/RPC) rather than read-modify-write in JS.

### G. No swap / overnight financing cost modeled — OPEN
Neither `spreadConfig.ts`, the generator, the resolver, nor the backtest applies rollover/swap. Swing trades held
multiple nights on forex (and the synthetic equivalent) are therefore reported slightly optimistically. Magnitude is
small per night but systematic and always negative on the side carrying the cost; with swing expectancy already at
−0.063R this is not negligible for the swing book specifically.

### H. No economic-news blackout filter for forex — OPEN
No calendar feed and no blackout window anywhere in the codebase. High-impact releases (NFP, CPI, rate decisions)
produce exactly the spread-widening and gap behavior the cost model does not capture. Synthetics are unaffected.
Implementation would need an external calendar source plus a generation-time suppression window (e.g. −30/+30 min
around high-impact events for the affected currencies).

### I. V50 stop clamp — client-side only, needs server port
Confirmed present only in `src/lib/tradeSignalGenerator.ts` (see issue A for exact lines). Same fix as A; called out
separately because it is the specific change whose benefit has already been measured.

### J. Server and client target ladders have diverged — OPEN (code hygiene, not expectancy)
Server and client ladders have diverged and should share one canonical module (server's geometry, since it measured
better) to prevent a fourth silent drift. Server uses 1.5 / 2.5 / 4 R; client uses 1.2 / 2.0 / 3.0 R with per-instrument
ATR reach caps for synthetics and 2 / 3.5 / 5.5 R for forex. Measured 12-month walk-forward on the server path
(synthetics, clamp on, spread + volatility costs): server ladder −0.042R avg (n=47, 27.7% win); widened 1.8/3.0/4.5
−0.261R (n=43); client ladder ported to the server −0.165R (n=53, 37.7% win). None significant (|t| < 1.2), but the
server's existing geometry is the best of the three, so unification should adopt it rather than the client's.
Not urgent: it does not change current trade expectancy. This is the third divergence after outcome resolution and the
stop clamp.

### K. Synthetics minimum R:R was unreachable — RESOLVED 2026-09-15
`synthetic_min_rr` was 2.5 while the server ladder puts TP2 at exactly 2.5R *pre-spread*, so the spread-adjusted check
could never reach the threshold and the server synthetics path was fully switched off. Default and existing settings
lowered to 2.4. Re-measured with the real 2.4 gate: synthetics n=39, 28.2% win, avg R −0.015, spread/risk 0.7%.
Residual note: V50 still produces zero server signals at 2.4 (its spread-adjusted ratio averages ~2.18).

### L. Arbitration unified in Postgres; server engine now arbitrated — RESOLVED 2026-09-16
Item B is closed by moving arbitration out of TypeScript and into the database.

**What changed**
- `public.correlation_pairs` — new table, the single source of truth for correlated instruments
  (8 rows, seeded from the previous hardcoded list). Readable by any signed-in user; no code copy remains.
  `src/lib/correlation.ts` now loads it via `fetchCorrelationPairs()` / `useCorrelationPairs()`.
- `public.arbitrate_signal(user, instrument, direction, trade_type, confidence)` — SECURITY INVOKER, returns
  `{allowed, reason, code, cancel_ids}`. Implements the same three rules: one active setup per pair,
  >=5-point confidence edge for a reversal replacement, correlation blocking at critical severity (avg confidence >= 70).
- `supabase/functions/signal-engine/index.ts` calls the RPC before every insert and **fails closed**: RPC error,
  null verdict, or unexpected shape blocks the signal and is recorded in the run's `errors`. The engine's old
  ad-hoc "check existing pending on this instrument" branch (and its duplicated insert path) is deleted; there is
  now a single insert path, and the `notify_min_confidence` gate applies to it uniformly (previously it was skipped
  on the existing-pending branch).
- `src/hooks/useGeneratedSignals.ts` calls the same RPC, also fail-closed. The TypeScript arbiter is **removed from
  the app**: `src/lib/signalArbiter.ts` no longer exists. The only remaining copy is `.backtest/arbiterModel.ts`,
  explicitly labelled backtest-only (the offline harness cannot do a DB round-trip per candidate).

**Parity before cutover**: the old TS arbiter and the RPC were run against the live pending book (803 pending rows)
over a 336-case candidate grid (14 instruments x 2 directions x 2 trade types x 7 confidence levels).
**336/336 identical** — allowed flag, decision code and cancel-id set.

**Before/after, server-generated signals** (`.backtest/engine_arb.ts`, 12-month walk-forward, server generator,
stop clamp on, wick resolution, spread + volatility costs, `synthetic_min_rr` 2.4):

| Run | Generated | Resolved n | Win rate | avg R | net R | t |
|---|---|---|---|---|---|---|
| BEFORE — per-instrument lockout, no arbiter | 142 | 79 | 26.6% | −0.054 | −4.2 | −0.30 |
| AFTER — shared arbitrated book | 207 | 76 | 25.0% | −0.127 | −9.7 | −0.73 |

Split, AFTER: synthetics n=39, 28.2%, −0.015 (identical to BEFORE — the synthetics book never overlaps);
forex/metals n=37, 21.6%, −0.246 (BEFORE n=40, 25.0%, −0.091).
Arbitration blocked 29,133 candidate evaluations and performed 82 reversal replacements; **0 correlation blocks in
12 months** — correlated forex setups were never pending simultaneously at critical confidence in the replay.

Honest read: arbitration did **not** improve measured expectancy; the AFTER figure is slightly worse, driven entirely
by forex, and the difference is not significant (|t| < 1.1, n=76-79). The volume rise (142 -> 207) comes from the
reversal-replacement rule, which the old engine did not have. The justification for this change is correctness and
de-duplication — one implementation, one correlation list, fail-closed — not measured edge.

---


## Priority order if work resumes

1. Make the `daily_performance` increment atomic — item F (correctness of the daily risk guard).
2. Re-measure confidence bands once a few hundred post-fix signals exist — item C; reweight only from that data.
3. Shared target-ladder module (server geometry) — item J, code hygiene, prevents a fourth drift.
4. Swap costs (G) and news blackout (H) — both improve realism of the measurement, neither changes signal quality
   directly.

Closed this session: A (stop-clamp port), B/L (arbiter unification in Postgres), D (ordered + paged pending query),
E (cron de-duplication), K (synthetics R:R gate at 2.4).
Still open: C (confidence re-weighting), F (atomic daily counter), G (swap cost), H (news blackout),
I (folded into A), J (shared ladder module).

## Harness notes

- `.backtest/fetch.ts` refetches the dataset to `/tmp/bt/data.json` (sandbox temp is wiped between sessions).
- `.backtest/prod.ts` + `.backtest/prodstats.ts` = production-accurate baseline; `.backtest/variants.ts` = day-trade
  geometry variants. All import live code directly — no reimplementations.
- Deriv retention ceiling is ~12 months for 1H (forex ~5,990 1H candles; synthetics 8,640). Five-year backtests are
  not possible above D1.

---

## Session close — 2026-09-16 00:20 UTC

### Baseline marker for the next check-in

Live database counts at 2026-09-16 00:20 UTC (resolved = `outcome` set and not `pending`):

| Path | Resolved | Total rows |
|---|---|---|
| `engine_generated = true` | 270 | 299 |
| `engine_generated = false` | 4,055 | 4,833 |
| **Combined** | **4,325** | **5,132** |

Next check-in question — "how many new signals have resolved since the baseline?" — is answered by:

```sql
select engine_generated,
       count(*) filter (where outcome is not null and outcome <> 'pending') as resolved
from generated_signals
where generated_at > timestamptz '2026-09-16 00:20:00+00'
group by 1;
```

Everything generated after that timestamp is post-fix: arbitrated through `public.arbitrate_signal()` on both paths,
server stop clamp active, synthetics R:R gate at 2.4, ordered/paged outcome resolution, single outcome cron.

### "As of today" expectancy baseline

Final end-to-end walk-forward, current code exactly as deployed (real arbiter model, unified paths, 2.4 synthetics
gate, stop clamps on, wick resolution, spread + volatility costs), 12-month Deriv history, all 12 instruments,
both trade types:

- Generated 428 · cancelled by reversal 67 · never filled 26 · unresolved 10 · **resolved n = 325**
- Win rate **33.2%** · **avg R −0.092** · net −29.90R · t = **−1.22**
- **95% CI on avg R: −0.240 to +0.056** — still not distinguishable from zero.
- Split: swing n=127, 40.2%, −0.074 · day n=198, 28.8%, −0.104
- Forex n=130, 25.4%, −0.068 · Synthetics n=195, 38.5%, −0.108
- Best instruments: XAU/USD +0.676 (n=22), GBP/USD +0.374 (n=14), V10 +0.143 (n=40)
- Worst: AUD/USD −0.393 (n=28), USD/JPY −0.298 (n=28), V100 −0.274 (n=41)

Note on comparability: this run is **not** the same number as the +0.053R (n=221) figure recorded earlier in this
document. That run used the old per-instrument client arbiter; this one uses the unified arbitration model, which
admits the reversal-replacement rule and therefore a larger, differently-composed signal book (428 generated vs 308).
Compare future runs against **this** row, not the earlier one.

Confidence bands remain flat-to-inverted (90–100: n=9, 11.1%, −0.698; <60: n=159, 38.4%, +0.051), which is item C
restated on the current code — the re-weighting decision should wait for real post-baseline data.

### Honest one-line summary

The system is measurably neither profitable nor unprofitable at this sample size; every change closed this session was
justified by correctness, cost realism, or de-duplication, not by a demonstrated edge.

---

## Session addendum — 2026-09-21 08:05 UTC

### M. Pending signals never expired, so the arbiter locked every pair — RESOLVED 2026-09-21

Symptom: no new signals generated since 2026-09-16 00:08 UTC (the arbiter cutover). Cron jobs 2 and 5 fired on
schedule and reported success throughout; nothing crashed.

Root cause: `arbitrate_signal` treated *every* `outcome = 'pending'` row as a live setup occupying that
instrument's slot. Since the tick fallback was retired, an unfilled signal stays pending indefinitely, so all 12
instruments (both trade types) were permanently occupied — 723 pending rows, e.g. V25 105 swing, V10 99 swing.
The arbitration rules themselves were correct (336/336 parity with the old client copy); the missing piece was a
setup-window expiry. Exposed by the migration, not introduced by it.

Fix:
- New `public.signal_slot_is_live(trade_type, generated_at)` — window reused from the app's existing staleness
  thresholds (`src/hooks/useSignalRevalidation.ts`: swing 24h, day 4h). No new number invented.
- `arbitrate_signal` now applies that predicate to all three pending lookups (same-direction, opposing, correlation).
- Engine `checkOutcomes()` sweeps: a pending signal past its window whose entry never filled (wick-verified) is
  marked `cancelled`, never won/lost.
- Expiry status is **`cancelled`**, not a new status — existing stats already exclude cancelled rows from win/loss,
  so an expired setup can never become a phantom loss (the pre-fix tick-fallback failure mode).

One-pass backfill: pending **723 → 0** (141 day, 582 swing; all 723 were past window). Cancelled 783 → 1506.
All 12 instruments freed immediately. Verified post-fix: `arbitrate_signal(EUR/USD, bullish, swing, 75)` →
`allowed: true, code: approved`.

Generation resumption **not yet observed** — see item N. The block is now the data feed, not the arbiter.

### N. Single price provider — confirmed LIVE failure, not theoretical — OPEN

Deriv is the only market-data source; there is no fallback. Since ~2026-09-20 09:15 UTC every Deriv WebSocket
endpoint (`ws.derivws.com`, blue/green/red, `ws.binaryws.com`) returns Cloudflare 520. Engine logs at 08:00-08:01
on 2026-09-21 show `1H candle fetch failed` for all 12 instruments. Consequences while it lasts:
- No new signals can be generated (no candles → no analysis), independent of the item M fix.
- No pending outcomes can be resolved (wick replay needs 1H OHLC).
- The item M expiry sweep in the engine also cannot run per-signal (it is fill-gated on candles); the SQL-side
  arbiter predicate is unaffected, so slots still free themselves on schedule.

No code fix exists for an upstream outage. The real open item is the absence of any secondary data provider.

### Status after this addendum

Resolved: A, B, D, E, K, L, M. Open: C (confidence re-weighting, blocked on data), F (atomic daily counter),
G (swap costs), H (news blackout), J (shared ladder module), N (single data provider, actively failing).

---

## Post-recovery verification — 2026-09-21 08:25 UTC

### Item M — expiry fix verified under real load

Deriv's public market-data endpoint recovered. State at 08:25 UTC:

| Metric | Value |
|---|---|
| Pending rows (was 723, backfilled to 0) | **7** |
| Distinct instruments holding a slot | 7 (GBP/USD, USD/JPY, AUD/USD, GBP/JPY, V10, V100, BOOM1000) |
| Trade types | swing only this window |
| Signals generated since recovery (08:10–08:19 UTC) | **7**, all approved by `arbitrate_signal` |
| Blocked-by-stale-pending events | 0 |

All 7 new signals cleared arbitration on previously-locked pairs (V10 and V100 had 99 and ~100 stale pending rows before the sweep), which is the live proof the expiry rule freed the slots. No boundary edge case exists: the backfill cancelled every pre-outage pending row, so nothing is sitting near a window edge — the oldest live pending row is minutes old.

Cron health over the same window: job 2 (`*/5`) succeeded on every run through 08:20; job 5 (`5 * * * *`) succeeded at 07:05 and 08:05. No backlog choke, no errors from the gap.

### N. Single price provider — partially mitigated 2026-09-21

The outage was **not uniform across Deriv**. `wss://api.derivws.com/trading/v1/options/ws/public` recovered (and was serving the app), while `ws.derivws.com` and `ws.binaryws.com` remained dead. The app had an endpoint fallback list (`src/lib/deriv.ts`); the edge function did not — it hardcoded
`wss://ws.derivws.com/websockets/v3?app_id=1089`. So after recovery the app generated signals normally while the engine still logged `1H candle fetch failed` for all 12 instruments. A fourth client/server divergence, same pattern as outcome resolution, stop clamp and target ladder.

Fix: `signal-engine/index.ts` now routes every Deriv call through one `derivRequest()` helper that walks the same endpoint list as the app (public endpoint first, then the legacy app_id endpoints), resolving on the first that answers. `fetchCandles()` and `getCurrentPrice()` both use it. `DERIV_APP_ID` is overridable via env. Verified post-deploy: manual `analyze` run at 08:22 completed with **zero candle-fetch errors** (previous run: 12 failures).

Still open in the original sense: all endpoints are Deriv. A genuinely independent second provider does not exist in the codebase.

### Generation rate note

The 08:22 manual run generated 0 signals with no errors — 7 of 12 pairs were legitimately slot-occupied by the fresh signals above, and the remaining 5 produced no setup clearing `notify_min_confidence = 75` plus the R:R gates. That is normal filtering, not blocking. Rate to watch over the next few hours: engine signals should appear on the free pairs at the XX:05 runs.

---

## Item C — confidence re-weighting study (2026-09-21, backtest-derived)

### Why this was possible without waiting for live volume

Only 5 live rows carry `confluence_breakdown`, so a DB-based regression was impossible.
The walk-forward harness imports `generateTradePlan()` directly, so the returned
`recommendation.confidenceBreakdown` / `dayTradeRecommendation.confidenceBreakdown` are
the *same objects* the app persists. Reverified after the history-fetch hardening:
**329 simulated signals, 0 missing a breakdown**, 29 distinct swing items and 7 day items captured per signal
(`.backtest/cscore.ts`, analysis in `.backtest/cstats.ts`).

### Design

12-month production-accurate walk-forward (real `arbitrateSignal`, wick resolution,
spread + ATR-percentile costs, `requiresFill`, one setup per instrument/type).
329 generated, 42 replaced, **248 resolved**. Split chronologically at the median
generation time: **TRAIN 124** (2025-12-11 → 2026-06-01), **HOLDOUT 124**
(2026-06-01 → 2026-09-18). Holdout untouched during analysis.

### Training-half component correlations vs realized R

Swing (n=83). Strongest positive: OBV 4H r=+0.131 (t=1.19), CHoCH 4H r=+0.128
(t=1.16). Strongest negative: Fair Value Gaps r=−0.149 (t=−1.35), CE r=−0.136
(t=−1.24), Breaker Blocks r=−0.135 (t=−1.22).
Day (n=41). 1H Price Action was r=−0.314 (t=−2.07) on train but reversed to r=+0.017
(t=0.13) on holdout, so it did not validate. `corr(confidence, R)` = −0.055 train,
+0.111 holdout: weak and inconsistent.

### Verdict — no reweighting proposed, nothing implemented

No component survives holdout validation or multiple-comparison correction. The one nominal
training result (1H Price Action, |t|=2.07) disappears completely on holdout. Confidence-band
cells remain too small (90–100: n=1 train, n=3 holdout) for credible separation. Any weight
change fitted to these correlations would still be curve-fitting.

Item C therefore **stays open**, with the method now proven and reusable: the harness
captures breakdowns correctly, so re-running `.backtest/cscore.ts` + `.backtest/cstats.ts`
against a longer history (or once live breakdown rows accumulate) is a one-command repeat.
The blocker was never tooling — it is sample size. Rough requirement: ~300+ resolved signals
per trade type before per-component t-stats can distinguish a real weight from noise.

---

## Addendum 2026-09-21 (late) — item C follow-ups: gate predictiveness and confidence usage

Method identical to the component study: live data still too thin (5 breakdown rows, none resolved
with a realized R), so this ran on the 12-month backtest history with a gate-bypassed copy of the
real generator (`.backtest/genUngated.ts`, `.backtest/gates.ts`) so suppressed candidates could be
scored. Freshly refetched dataset (`.backtest/fetch.ts` hardened: reconnect + retry + `echo_req.req_id`
fallback, since the old single-socket fetch silently returned 0 candles for 11 of 12 instruments).

**Data-provenance correction:** the first gate report (2,710 resolved; zone r=−0.047 train,
r=−0.044 holdout, full t=−2.36; both-gates holdout −0.010R) ran before the failed refetch attempts,
using the pre-existing cache. It did not consume the later empty/partial files, but that cache was
not instrument-validated or preserved. The result does not reproduce on the hardened refetch and is
therefore **withdrawn and must not be used**. The old fetcher then produced one all-empty file and one
partial file; no reported analysis was run against either. The figures below were rerun from a dataset
whose candle counts were verified for all 12 instruments. The gate candidate set itself contains six
synthetics because the ungated day generator produced no eligible forex candidate in this run; that is
generator output, not missing input data.

Candidates 2,683 · resolved 2,659 · would-be-suppressed by the live gates 2,221.
Chronological split: TRAIN 1,329 (2025-12-11 → 2026-04-30), HOLDOUT 1,330 (2026-04-30 → 2026-09-21).

### C1. Do the day-trade hard gates predict realized R? — NULL

| Gate | TRAIN corr (t) | avgR pass / fail | HOLDOUT corr (t) | avgR pass / fail |
|---|---|---|---|---|
| structural | +0.004 (0.16) | +0.023 / +0.011 | −0.014 (−0.50) | +0.015 / +0.053 |
| zone | −0.035 (−1.29) | −0.044 / +0.054 | +0.019 (+0.68) | +0.066 / +0.015 |
| both | +0.005 (0.19) | +0.033 / +0.014 | −0.001 (−0.05) | +0.031 / +0.036 |

The zone gate's mild negative sign on the training half **flips positive on the holdout**. That is the
textbook signature of noise, not a real effect. Structural is flat in both halves. No gate has
measurable predictive power in either direction.

### C1b. Drop-zone-gate-entirely variant — does not help, not implemented

| Selection | TRAIN n / avgR / netR | HOLDOUT n / avgR / netR |
|---|---|---|
| current (both gates) | 208 / +0.033 / +6.9 | 243 / +0.031 / +7.5 |
| drop zone gate (structural only) | 596 / +0.023 / +13.8 | 620 / +0.015 / +9.4 |
| drop both gates (reference) | 1,329 / +0.017 / +22.2 | 1,330 / +0.035 / +46.9 |

Dropping the zone gate roughly **triples volume but lowers average R in both halves** (+0.033 → +0.023
train, +0.031 → +0.015 holdout). Net R rises only because there are ~3x more trades, and every cell's
95% CI spans zero (all |t| < 1.0). No clear improvement, so **nothing was changed** — the gates stay
exactly as they are. Caveat: the ungated harness de-overlaps one open day trade per instrument, so
these are relative comparisons within one selection rule, not live production counts.

### C2. Where confidence actually changes behaviour — audit of non-display reads

`confidence` / `dayConfidence` in `src/lib/tradeSignalGenerator.ts` and
`supabase/functions/signal-engine/index.ts` is computed **after** the pass/fail gates have already
decided whether a signal exists. It is not an input to zone, structural, R:R or session filtering.
Non-display uses, complete list:

1. **Publish / alert cutoff** — engine compares confidence against the user's `notify_min_confidence`
   (75 by default); below it the signal is not emitted or alerted.
2. **Arbiter reversal edge** — `public.arbitrate_signal()` replaces an existing pending setup only when
   the opposing candidate scores **>= 5 points higher**.
3. Confidence-band reporting and UI tiering (display only).

Consequence: given the null on component weights, (2) is the only place a mis-weighted score can change
which trades exist, and it is a relative comparison between two signals scored by the same formula. A
flat score degrades that rule to roughly a coin flip on reversals rather than doing active harm.

Item C remains **OPEN**, unchanged in substance: the scoring is cosmetic-to-weakly-relevant, and
sample size — not tooling — is still the blocker.

---

## Item O — Swing confidence unified and made internally consistent (2026-09-25)

### What was wrong (found by code audit, not backtest)
- The app's swing **confidence** came from `calculateConfluenceScore()` (7 categories), but the **saved breakdown**
  came from a separate 29-item direction vote. The breakdown did not describe the number shown.
- The engine scored swing confidence with a third, different formula; its saved breakdown omitted 6 scored parts (9 pts).
- The engine has no day-trade path, so the day-trade formula fix only ever existed in the app (no drift possible there).
- Denominators were unreachable or exceedable: app formula max was really 46 (not 48); synthetics used 44, so they could
  exceed 100% before the 95 cap. Engine raw max was 46 against 48 / 44.
- Several app items were not relative to the trade direction: timeframe/MACD agreement scored even when agreeing
  *against* the trade; OB/FVG availability scored either polarity; premium/discount was measured against the daily
  trend, not the trade; a same-direction 4H liquidity sweep scored (project rule: opposite-side sweep confirms).
- The engine analysed the forming candle; the app analyses closed candles only.

### Fix
- `supabase/functions/_shared/analysis/` now holds the canonical analysis (indicators, SMC, price action, synthetic
  profiles, `analyzeMarket`) and `swingConfidence.ts`. `src/lib/*` re-export them; the engine imports them. One file each.
- `computeSwingConfidence()` returns items; total = Σweight, max = Σmax = 46 for every instrument, each item clamped to
  its own max, confidence = min(round(total/46·100), 95). Breakdown saved = items, so total/max reproduces the number.
- Engine now feeds closed candles. Engine direction voting and trade geometry are unchanged (only scoring was unified).

### Which formula and why (measured)
Same 12-month walk-forward, all 12 instruments, real arbiter, 281 swing generated / 141 resolved, chronological split
(train 70 to 2026-05-05, holdout 71 to 2026-09-22). Confidence ≥55 filter removed for swing so all three scores see the
same sample. Correlation of each score with realised R:

| score | train | holdout | full |
|---|---|---|---|
| old app score | r −0.117 (t −0.97) | r −0.168 (t −1.42) | r −0.144 (t −1.72) |
| 29-item vote | r −0.031 (t −0.25) | r −0.116 (t −0.97) | r −0.075 (t −0.88) |
| unified | r −0.092 (t −0.76) | r −0.153 (t −1.29) | r −0.125 (t −1.48) |

None predicts R. The choice was therefore made on integrity: the unified formula is the only one that is direction-correct,
has a reachable constant max, and whose breakdown equals the displayed number. corr(old app, unified) = 0.90.
Integrity assertions held for all 281 signals (breakdown sum == total, confidence matches); 0 over max; 0 at the cap.

### New study — swing confidence, post-unification (separate result, NOT merged with the earlier null)
- Score level: null. Every score leans slightly **negative** in both halves, but not significant (|t| < 2).
- Terciles (full): low 30–50 n=47 win 51.1% +0.184R; mid 50–57 n=47 25.5% −0.386R; high 57–72 n=47 36.2% −0.113R. Not monotonic.
- Components: 31 items, none reaches |t| ≥ 2 with the same sign in both halves. Two single-half hits don't replicate
  (4H FVG quality train t −2.15 → holdout +0.06; 4H OB quality train −0.67 → holdout −2.47).
- Verdict: on a correctly and consistently computed score, swing confidence has no measured predictive power. No reweighting.
- Formula redundancy noted, not changed: directional OB/FVG ≥40 is counted in both Price Action and Entry Zone items
  (the pairs are identical in the table above).
- Tooling: `.backtest/swingscore.ts`, `.backtest/swingstats.ts`, frozen old score `.backtest/legacySwingScore.ts`.
- Behaviour note: synthetics' swing confidence drops ~4% relative (denominator 44 → 46); any user notify threshold sees this.
- Fetcher: now retries on RateLimit and refuses to save incomplete data (it had silently saved empty series).

### Item O addendum (2026-09-25): tier significance and component frequency

Script: `.backtest/swingtiers.ts`. Same sample rebuilt from re-downloaded data: 281 generated, 141 resolved (train 70 / holdout 71). Breakdown integrity checked for every signal.
Terciles are uneven (57/41/43) because many scores tie at the 50 and 57 cut points.

| Tier (full) | n | W/L | Win % (95% CI) | Mean R | t vs 0 |
|---|---|---|---|---|---|
| low ≤50 | 57 | 30/27 | 52.6% (40–65) | +0.222 | +1.26 |
| mid 51–57 | 41 | 7/34 | 17.1% (9–31) | −0.604 | −4.01 |
| high >57 | 43 | 16/27 | 37.2% (24–52) | −0.062 | −0.30 |

Low vs mid: full t=+3.57 (p=0.001); train t=+2.13 (p=0.039); holdout t=+2.95 (p=0.005); holdout with training-half cuts t=+2.99 (p=0.004). Low vs high and mid vs high: not significant after correction. Trend across all scores (Spearman): rho −0.145, p=0.087 — no monotonic relationship.
Verdict: **unconfirmed, on watch.** The mid-tier weakness has the same sign in both halves, which the withdrawn zone-gate result did not. But it fails the pre-set bar: train p=0.039 misses the corrected threshold of 0.017. The tiers were also drawn after looking at the full sample, and there's no plausible reason for the middle to lose while both ends don't. The low tier is not significantly profitable (t=+1.26). No change to scoring. Re-test on new live data only.

Component frequency (scored >0), wins 53 / losses 88. The smallest gap this sample can reliably detect is about 24 points. Largest gaps: RSI 1H in trend band 87% vs 64% (+23; train +24, holdout +22); Daily Structure 66% vs 52% (+14); 4H+1H trend 19% vs 32% (−13); MACD Daily 38% vs 50% (−12). Items present in ≥90% of all trades (RSI Daily, Breaker 4H, FVG quality/available) tell you nothing about wins vs losses. These numbers are descriptive only.

### Item O addendum 2 (2026-09-25): base rate, re-test trigger, tier mechanism, combination search

**RSI 1H in trend band — base rate for context on the 87% vs 64% gap**

| population | present / n | rate |
|---|---|---|
| all generated swing candidates | 201/281 | 71.5% |
| unresolved (unfilled or cancelled) | 99/140 | 70.7% |
| resolved | 102/141 | 72.3% |
| resolved wins | 46/53 | 86.8% |
| resolved losses | 56/88 | 63.6% |

The component is present in roughly 7 of every 10 candidates, so the win-side 87% is +15 pts over base rate and the
loss-side 64% is −8 pts. Presence does not affect whether a signal fills (50.7% of present candidates resolved vs 48.8%
of absent), so the gap is not a fill-selection artefact. Split on resolved trades: present n=102, 45.1% win, +0.051R;
absent n=39, 17.9% win, −0.512R.

**Re-test trigger (concrete)**

Power calculations at alpha 0.05, 80% power, using the observed effect sizes and the observed 72/28 presence split:
- tier gap (low vs mid, Δ≈0.50R, sd≈1.25): ~65 per tier → **~195 resolved swing trades**
- RSI 1H win-rate gap (45% vs 18%): 104 present + 41 absent → **145 resolved swing trades**
- RSI 1H mean-R gap as a continuous test: **~264 resolved swing trades**

**Trigger: 200 new live-generated swing trades, resolved under the unified formula, with an interim look at 100.**
Until then no reweighting, no tier gate, no RSI 1H gate. At 100 the check is diagnostic only (does the sign hold);
at 200 it is decisive and uses the same train/holdout discipline. The 100-trade interim check includes a
shippable-only tier breakdown (confidence ≥55 and spread-adjusted min R:R gate applied, matching prod.ts
filters) so the tier pattern gets its first test on a real, shipping population at the same time as everything
else — no separate trigger or special case for it.

**Why the ≤50 tier beats the 51–57 tier — mechanism, not pattern** *(see close-out below: RETRACTED — derived
from the non-shippable sub-55 population, so it does not describe shipped signals; kept for the record only)*

Three compositional differences, in order of size:

1. *Instrument clustering.* V25 (20 trades, 60.0% win, +0.208R) and V50 (9, 77.8%, +0.302R) are the two best instruments
   in the sample and they score low, because synthetic setups clear fewer multi-timeframe alignment items. They are
   18/57 of the low tier and supply 13 of its 30 wins, but only 5/41 of the mid tier. Removing them: low falls to n=39,
   43.6%, +0.148R; mid stays n=36, 11.1%, −0.704R. So V25/V50 explain part of the low tier's strength but **not** the
   mid tier's weakness — the gap narrows, it does not close.
2. *The mid tier is where mature trend-continuation setups sit.* Components the mid tier scores far more often than the
   low tier are exactly the ones with negative win-loss gaps: MACD Daily (59% vs 26%; overall 38% of wins vs 50% of
   losses), 4H+1H trend with trade (27% vs 7%; 19% vs 32%), 4H OB quality (95% vs 75%), Daily trending (85% vs 67%).
   These are late-in-move entries: full daily/4H/1H agreement plus a mitigated 4H order block. Plausible mechanism, not
   a tested one.
3. *RSI 1H deficit.* Present in 75% of low-tier trades but only 61% of mid-tier — the one component with a consistent
   positive gap is under-represented exactly where performance is worst.

The mid tier is therefore not "middling confidence"; it is a distinct population (trend-mature, synthetic-light,
RSI-1H-light). That is a real compositional explanation, and it also means the tier boundary is a proxy for setup type
rather than a measure of confidence. Still not acted on — see the trigger above.


**Combination search — train only, reported on holdout**

Same chronological split (train 70 to 2026-05-05, holdout 71). Exhaustive search over all 31 components: 465 pairs and
4,495 triplets, scored by train ROC-AUC, plus an L2 logistic fit on all 31 features. Baseline unified score: train
AUC 0.406, holdout 0.392 (worse than chance, consistent with the earlier null).

| candidate (selected on train) | train | holdout |
|---|---|---|
| RSI 1H alone | n=46, 45.7%, +0.085R vs rest −0.484R (t +1.88, p=0.066) | n=56, 44.6%, +0.023R vs rest −0.555R (t +1.58, p=0.127) |
| Daily Structure + RSI 1H (both) | n=25, 52.0%, +0.368R vs −0.376R (t +2.15, p=0.038) | n=28, 57.1%, +0.304R vs −0.362R (t +2.14, p=0.037) |
| ≥2 of {BOS 4H/D, Daily Structure, RSI 1H} | n=45, 51.1%, +0.253R vs −0.766R (t +4.11, p<0.001) | n=45, 48.9%, +0.133R vs −0.501R (t +2.14, p=0.037) |
| L2 logistic, all 31 features | AUC 0.839, r +0.492 | AUC 0.703, r +0.212 (p=0.075) |

**Verdict: no combination survives the holdout at the bar we set.** The two rule-style candidates do reproduce their
sign and rough size out of sample at p≈0.037, which is more than the zone gate ever managed. But they were picked as
the best of ~4,960 tested combinations; the multiplicity-corrected threshold is ~1e-5, and flipping the two most influential holdout
outcomes moves p from 0.037 to 0.197 (checked exhaustively over all 2,485 pairs). The logistic fit degrades from AUC 0.839 to 0.703 with a non-significant holdout
correlation — the usual signature of fitting noise. Nothing here is proposed for use. Every one of these candidates
contains RSI 1H, which is the same single descriptive lead already on watch; they are not independent evidence.
No change to the formula, gates, or scoring. Re-check at the 200-trade trigger.

### Item O — population caveat (2026-09-25)
The swing-confidence tier study is NOT the shipped population. Its harness (.backtest/swingscore.ts) drops the confidence ≥55 filter for swing (day keeps it), so 81 of 141 resolved swing trades (57%) have confidence <55 and would never be generated by prod.ts. It has no spread-adjusted min R:R gate (that gate exists only in signal-engine). Data is a fresh 2026-09-25 refetch, not the file used for earlier production-accurate runs. V25/V50 strength lives almost entirely in the sub-55 trades (V50: 5/5 wins, +3.76R below 55; 2/4, −1.04R at ≥55). The low-tier "mechanism" is therefore not a finding about shipped signals. Status: unconfirmed, not logged as a mechanism.

### Item O — close-out (2026-09-25)
- **Tier mechanism explanation: RETRACTED.** It was derived from the non-shippable population (sub-55-confidence trades that prod.ts never generates); it does not describe any signal the app sends.
- **Tier pattern itself: UNCONFIRMED and untested on a shippable population.** No rerun on the ~60 shippable trades — the computed sample size for this effect size is ~195 resolved swing trades (63 per tier), so a rerun now would only produce another inconclusive result.
- **Trigger: no special case.** The tier pattern shares the item O trigger — 200 new resolved swing trades, decisive; 100-trade interim check diagnostic. The shippable-only tier breakdown (≥55 confidence + spread-adjusted min R:R, matching prod.ts) is part of the 100-trade interim check, not a separate study.
- Until the trigger fires: no reweighting, no tier gate, no RSI 1H gate, no scoring change of any kind.

### FINAL session entry — production-accurate walk-forward, all fixes active (2026-09-25 22:00 UTC)
**Supersedes +0.053R and −0.092R.** Those figures predate one or more of today's fixes (DB arbiter slot window/expiry, unified swing confidence, engine stop clamp + 2.4 gate in a shared book) and describe a no-longer-current system.

- **Data:** fresh fetch 2026-09-25 21:51 UTC with the hardened fetcher (.backtest/fetch.ts: reconnect, RateLimit retry, refuses incomplete saves). All 12 instruments non-empty (forex ~5,988 1H / 1,536 4H / 256 D1; XAU 5,726/1,522/255; synthetics 8,640/2,160/360). No earlier cache reused.
- **Harness:** .backtest/final.ts. Manual = client generateTradePlan (conf ≥55, 4h cadence as prod.ts). Engine = signal-engine generateSignal extracted verbatim (stop clamp, synthetic min_rr 2.4, notify ≥70, hourly). One shared pending book, arbitrated by the parity-verified mirror of arbitrate_signal, slot live 4h day / 24h swing, unfilled orders expire at the same window. ATR-percentile spreads, wick-path resolution.
- Blocked by arbiter: manual 3,159, engine 869; reversals replaced 1; expired unfilled 576.

| Population | generated | n resolved | win % | avg R | 95% CI | t |
|---|---|---|---|---|---|---|
| **Manual (all)** | 1,327 | 716 | 36.9% | −0.028 | −0.126 to +0.069 | −0.57 |
| Manual swing | 826 | 282 | 37.9% | −0.084 | −0.236 to +0.068 | −1.08 |
| Manual day | 501 | 434 | 36.2% | +0.008 | −0.118 to +0.134 | +0.12 |
| Engine | 54 | 3 | 66.7% | +1.325 | −0.954 to +3.603 | +1.14 |

- **Manual verdict:** expectancy indistinguishable from zero (slightly negative point estimate; CI spans ±0.1R). No demonstrated edge, no demonstrated loss.
- **Engine verdict:** too thin to mean anything (n=3). Not a result.
- Volume is higher than the old prod.ts run (345 generated) mainly because slots now free after the 4h/24h live window instead of being held until trade exit.

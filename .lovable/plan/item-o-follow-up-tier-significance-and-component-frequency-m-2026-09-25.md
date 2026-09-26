# Item O follow-up: tier significance and component frequency (measurement only)

No app or engine changes. This uses the same 141 resolved swing trades from the item O study (same data, same chronological train/holdout split), so the numbers are directly comparable.

## 1. Is the tier pattern real?

For each tercile (low 30–50, mid 50–57, high 57–72), on the full set and separately on train and holdout:
- n, wins, losses, win rate with a 95% interval (Wilson)
- mean R, standard deviation, standard error, one-sample t against 0R
- Pairwise tests: low vs mid, low vs high, mid vs high (Welch t on R, and Fisher's exact test on win/loss)
- A monotonic trend test (Spearman rank correlation of tier vs R) — the question is whether higher scores do better, not whether any single bucket stands out
- Multiple-comparison note: three pairwise tests, so a Bonferroni-adjusted threshold of p < 0.017
- Robustness: rerun with the cut points moved (quartiles, and terciles computed on the training half only and then applied to holdout) to check the shape isn't created by where the lines were drawn

Verdict stated plainly, using the same standard as the withdrawn zone-gate result: the pattern counts only if it holds in both halves with the same sign and passes the adjusted threshold. Otherwise it gets logged as noise, not as a finding.

## 2. How often each component showed up in wins and losses

For every item in the unified formula (all 31 scored items — order blocks, FVGs, premium/discount, structural bonus, timeframe and MACD alignment, liquidity sweep, breaker block, inducement, displacement, CE, and the rest), counted from the saved breakdown:
- Wins: how many wins had the item score above zero, and what % of wins that is
- Losses: the same count and %
- The gap (win % minus loss %) and the average points the item scored in wins vs losses
- Also split by train/holdout so it's visible whether a frequency gap holds in both halves
- Clearly labelled as descriptive only: no significance claims, and a note on the smallest gap this sample could reliably detect

Items that score in nearly every trade (for example, always-on alignment items) will be flagged, since appearing in most wins means little when they also appear in most losses.

## 3. Reporting

- Plain tables of counts and rates in chat, with t-stats and p-values next to them rather than in their place
- AUDIT.md item O gets an addendum with both tables and the tier verdict; the item closes only after this

## Technical details

- New script `.backtest/swingtiers.ts` reads the existing swing study output from `.backtest/swingscore.ts` (the same 281 generated / 141 resolved signals, cached 12-month data validated by the hardened fetcher) — no regeneration, so the sample is unchanged.
- The breakdown integrity check (item sum == total) is re-asserted before counting.

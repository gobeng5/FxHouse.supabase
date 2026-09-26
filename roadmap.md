# Roadmap

## Closed 2026-09-16 (session checkpoint — see AUDIT.md "Session close")
- [x] A — server stop-clamp port
- [x] B / L — arbitration unified in Postgres (`arbitrate_signal` RPC, `correlation_pairs` table)
- [x] D — ordered + paged pending-signal query
- [x] E — duplicate outcome cron unscheduled
- [x] K — synthetics R:R gate lowered to 2.4
- [x] Baseline marker + final walk-forward recorded in AUDIT.md

## Open
- C: re-measure/reweight confidence bands once post-baseline signals accumulate
- F: atomic `daily_performance` increment
- G: swap / overnight financing cost modeling
- H: forex economic-news blackout filter
- J: shared target-ladder module (adopt server geometry)

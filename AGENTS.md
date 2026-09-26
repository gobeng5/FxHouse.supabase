# Architecture rules

- Market analysis and swing confidence live only in `supabase/functions/_shared/analysis/`; `src/lib` re-exports and the signal engine imports them — one implementation so app and engine cannot drift.
- Files in `_shared/analysis/` must be runtime-neutral (no `@/` aliases, `.ts` extensions on relative imports) — they load in both Vite and Deno.
- Swing confidence: persisted breakdown must equal the scored items (total = Σweight, max = Σmaxweight = 46) — so saved numbers always reproduce the displayed confidence.
- Scoring uses closed candles only on both paths — deterministic, identical inputs.
- Arbitration and correlation pairs live in the database (`arbitrate_signal`, `correlation_pairs`) — single source for app and engine.

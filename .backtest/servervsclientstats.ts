/**
 * Train/holdout split of the server-vs-client comparison, matching the exact
 * methodology AUDIT.md's item C study already uses (cstats.ts/prodstats.ts):
 * chronological midpoint split (not random), one-sample t-stat against zero
 * expectancy per side, plus a two-sample (Welch) t-test comparing the two
 * sides directly within each window.
 *
 * Also checks:
 * - Agreement analysis: do trades where client+server independently agreed
 *   on direction perform differently than solo calls from either side?
 * - Confidence calibration: is each side's own confidence score actually
 *   correlated with real outcomes, or just noise dressed up as a number?
 *
 * Reads /tmp/bt/serverVsClient.json (written by serverVsClient.ts) — run that
 * first if this file doesn't exist yet.
 */
type Agreement = 'both_same' | 'both_opp' | 'client_only' | 'server_only';
type Rec = {
  id: string; source: 'client' | 'server'; inst: string; dir: 'bullish' | 'bearish'; conf: number;
  genEpoch: number; exitEpoch: number; filled: boolean; base: number | null; cancelled: boolean;
  agreement: Agreement;
};

const all: Rec[] = JSON.parse(await Bun.file('/tmp/bt/serverVsClient.json').text());
const live = all.filter(r => !r.cancelled && r.filled && r.base !== null);
live.sort((a, b) => a.genEpoch - b.genEpoch);

if (live.length < 20) {
  console.log(`Only ${live.length} resolved trades total — too few for a meaningful train/holdout split. Run serverVsClient.ts first if you haven't, or widen the date range.`);
  process.exit(0);
}

const epochs = live.map(r => r.genEpoch);
const cut = epochs[Math.floor(epochs.length / 2)];
const train = live.filter(r => r.genEpoch < cut);
const holdout = live.filter(r => r.genEpoch >= cut);
const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
console.log(`Resolved: ${live.length} | TRAIN: ${train.length} (${d(epochs[0])} -> ${d(cut)}) | HOLDOUT: ${holdout.length} (${d(cut)} -> ${d(epochs[epochs.length - 1])})`);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const variance = (a: number[]) => { const m = mean(a); return a.length > 1 ? a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) : 0; };
const sd = (a: number[]) => Math.sqrt(variance(a));

/** One-sample t-stat: is this group's avg R significantly different from zero? */
const tOneSample = (a: number[]) => {
  if (a.length < 2) return NaN;
  return mean(a) / (sd(a) / Math.sqrt(a.length));
};

/** Welch's two-sample t-test: do these two groups' avg R significantly differ from each other? */
const tWelch = (a: number[], b: number[]) => {
  if (a.length < 2 || b.length < 2) return { t: NaN, df: NaN };
  const va = variance(a), vb = variance(b), na = a.length, nb = b.length;
  const se = Math.sqrt(va / na + vb / nb);
  const t = (mean(a) - mean(b)) / se;
  const df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  return { t, df };
};

/** Pearson correlation — used here to check whether confidence actually tracks outcome. */
const corr = (xs: number[], ys: number[]) => {
  if (xs.length < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
};

const f = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(3);

function reportSide(label: string, g: Rec[]) {
  if (!g.length) { console.log(`${label}: n=0`); return []; }
  const r = g.map(x => x.base as number);
  const winRate = (g.filter(x => (x.base as number) > 0).length / g.length) * 100;
  const t = tOneSample(r);
  const ci = 1.96 * (sd(r) / Math.sqrt(r.length));
  console.log(
    label.padEnd(16), `n=${String(g.length).padStart(4)}`,
    `WR ${winRate.toFixed(1).padStart(5)}%`,
    `avgR ${f(mean(r)).padStart(7)}`,
    `95% CI [${f(mean(r) - ci)}, ${f(mean(r) + ci)}]`,
    `t(vs 0)=${isNaN(t) ? '-' : t.toFixed(2)}`,
  );
  return r;
}

function reportWindow(label: string, g: Rec[]) {
  console.log(`\n=== ${label} ===`);
  const clientR = reportSide('Client', g.filter(r => r.source === 'client'));
  const serverR = reportSide('Server', g.filter(r => r.source === 'server'));
  if (clientR.length >= 2 && serverR.length >= 2) {
    const { t, df } = tWelch(serverR, clientR);
    console.log(`Server vs Client: t=${t.toFixed(2)}, df=${df.toFixed(0)} ${Math.abs(t) >= 1.96 ? '(|t|>=1.96 -> plausibly significant at 95%, if this holds on holdout too)' : '(|t|<1.96 -> not distinguishable from noise at this sample size)'}`);
  } else {
    console.log('Server vs Client: not enough resolved trades on one side for a two-sample test.');
  }

  // --- Agreement analysis: does the OTHER engine agreeing predict quality? ---
  console.log(`\n--- ${label}: by agreement category ---`);
  const cats: Agreement[] = ['both_same', 'both_opp', 'client_only', 'server_only'];
  for (const cat of cats) {
    const sub = g.filter(r => r.agreement === cat);
    if (!sub.length) { console.log(`${cat.padEnd(14)} n=0`); continue; }
    reportSide(`  [${cat}]`, sub);
  }
  const agreed = g.filter(r => r.agreement === 'both_same');
  const solo = g.filter(r => r.agreement === 'client_only' || r.agreement === 'server_only');
  if (agreed.length >= 2 && solo.length >= 2) {
    const { t, df } = tWelch(agreed.map(r => r.base as number), solo.map(r => r.base as number));
    console.log(`Agreed (both_same) vs Solo calls: t=${t.toFixed(2)}, df=${df.toFixed(0)} ${Math.abs(t) >= 1.96 ? '(|t|>=1.96 -> agreement plausibly predicts quality)' : '(|t|<1.96 -> agreement does not distinguishably predict quality here)'}`);
  }

  // --- Confidence calibration: does a higher confidence score actually mean a better outcome? ---
  console.log(`\n--- ${label}: confidence calibration ---`);
  for (const source of ['client', 'server'] as const) {
    const sub = g.filter(r => r.source === source);
    if (sub.length < 3) { console.log(`${source.padEnd(8)} n=${sub.length} (too few to check calibration)`); continue; }
    const c = corr(sub.map(r => r.conf), sub.map(r => r.base as number));
    console.log(`${source.padEnd(8)} n=${sub.length} corr(confidence, R) = ${isNaN(c) ? '-' : c.toFixed(3)} ${!isNaN(c) && Math.abs(c) < 0.1 ? '(near zero -> confidence score is not tracking real outcome)' : ''}`);

    const bands: [number, number][] = [[80, 101], [70, 80], [60, 70], [0, 60]];
    for (const [lo, hi] of bands) {
      const band = sub.filter(r => r.conf >= lo && r.conf < hi);
      if (!band.length) continue;
      const wr = (band.filter(r => (r.base as number) > 0).length / band.length) * 100;
      const avgR = mean(band.map(r => r.base as number));
      console.log(`  conf [${lo}-${hi}) n=${String(band.length).padStart(3)} WR ${wr.toFixed(1).padStart(5)}% avgR ${f(avgR)}`);
    }
  }
}

reportWindow('TRAINING WINDOW', train);
reportWindow('HOLDOUT WINDOW', holdout);

console.log(`
Reading this the AUDIT.md way:
- A real, trustworthy finding needs |t| >= ~2 on BOTH train AND holdout, in the
  SAME direction. A pattern that appears in training and reverses or vanishes
  on holdout (as happened with the 1H Price Action finding in item C) is noise,
  not edge — no matter how clean it looked in training alone.
- Confidence calibration: if corr(confidence, R) is near zero in BOTH windows,
  that means the confidence score shown to users is not actually predictive —
  worth knowing regardless of which engine wins the head-to-head.
- With small per-category sample sizes (agreement breakdown, confidence bands
  split four ways), expect noisy numbers here. Treat every finding below as a
  lead to re-check with more data, not a conclusion to act on from this alone.
`);
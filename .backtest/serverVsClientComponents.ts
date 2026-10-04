/**
 * Component-level correlation with realized R — same methodology as the
 * existing item C study (cstats.ts), applied here to the server-vs-client
 * comparison instead of swing-vs-day. Answers: which individual confluence
 * factors (OB, FVG, BOS, CHoCH, RSI alignment, liquidity sweep, etc.) are
 * actually associated with winning trades, and does that differ between the
 * client's clean shared-analysis engine and the server's independent one?
 *
 * Reads /tmp/bt/serverVsClient.json (written by serverVsClient.ts) — run that
 * first if this file doesn't exist yet, or if you haven't re-run it since the
 * breakdown field was added.
 */
type Agreement = 'both_same' | 'both_opp' | 'client_only' | 'server_only';
type BItem = { label: string; value: string; weight: number; maxWeight: number; contributing: boolean };
type Rec = {
  id: string; source: 'client' | 'server'; inst: string; dir: 'bullish' | 'bearish'; conf: number;
  genEpoch: number; exitEpoch: number; filled: boolean; base: number | null; cancelled: boolean;
  agreement: Agreement; breakdown: BItem[];
};

const all: Rec[] = JSON.parse(await Bun.file('/tmp/bt/serverVsClient.json').text());
const live = all.filter(r => !r.cancelled && r.filled && r.base !== null);
live.sort((a, b) => a.genEpoch - b.genEpoch);

if (!live.some(r => r.breakdown && r.breakdown.length)) {
  console.log('No breakdown data found on any resolved trade. Re-run serverVsClient.ts with the');
  console.log('updated script (the one that captures confidenceBreakdown/confluence_breakdown) first.');
  process.exit(0);
}

const epochs = live.map(r => r.genEpoch);
const cut = epochs[Math.floor(epochs.length / 2)];
const train = live.filter(r => r.genEpoch < cut);
const holdout = live.filter(r => r.genEpoch >= cut);
const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
console.log(`Resolved: ${live.length} | TRAIN: ${train.length} (${d(epochs[0])} -> ${d(cut)}) | HOLDOUT: ${holdout.length} (${d(cut)} -> ${d(epochs[epochs.length - 1])})`);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const corr = (x: number[], y: number[]) => {
  const n = x.length; if (n < 3) return NaN;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
};
const tOf = (r: number, n: number) => r * Math.sqrt((n - 2) / (1 - r * r));

/** Same shape/columns as cstats.ts's component report, so results are directly comparable. */
function components(set: Rec[], source: 'client' | 'server', title: string) {
  const g = set.filter(r => r.source === source);
  if (g.length < 5) { console.log(`\n${title}: n=${g.length}, too few`); return; }
  const labels = [...new Set(g.flatMap(r => r.breakdown.map(b => b.label)))];
  console.log(`\n=== ${title} (n=${g.length}, avgR ${mean(g.map(r => r.base!)).toFixed(3)}) ===`);
  console.log('component'.padEnd(36), 'corr(w,R)'.padStart(10), 't'.padStart(7), 'onRate'.padStart(8), 'avgR|on'.padStart(9), 'avgR|off'.padStart(9), 'delta'.padStart(8));
  const rows: { label: string; c: number; t: number; on: number; off: number; delta: number; rate: number }[] = [];
  for (const L of labels) {
    const w: number[] = [], R: number[] = [], on: number[] = [], off: number[] = [];
    for (const r of g) {
      const b = r.breakdown.find(x => x.label === L);
      if (!b) continue;
      w.push(b.weight); R.push(r.base!);
      (b.contributing || b.weight > 0 ? on : off).push(r.base!);
    }
    const c = corr(w, R);
    rows.push({ label: L, c, t: tOf(c, w.length), on: on.length ? mean(on) : NaN, off: off.length ? mean(off) : NaN, delta: (on.length ? mean(on) : 0) - (off.length ? mean(off) : 0), rate: on.length / (on.length + off.length) });
  }
  rows.sort((a, b) => (isNaN(b.c) ? -9 : b.c) - (isNaN(a.c) ? -9 : a.c));
  for (const r of rows) console.log(
    r.label.padEnd(36),
    (isNaN(r.c) ? 'const' : r.c.toFixed(3)).padStart(10),
    (isNaN(r.t) ? '-' : r.t.toFixed(2)).padStart(7),
    (r.rate * 100).toFixed(0).padStart(7) + '%',
    (isNaN(r.on) ? '-' : r.on.toFixed(3)).padStart(9),
    (isNaN(r.off) ? '-' : r.off.toFixed(3)).padStart(9),
    (isNaN(r.on) || isNaN(r.off) ? '-' : r.delta.toFixed(3)).padStart(8),
  );
  return rows;
}

console.log('\n########## TRAINING WINDOW ##########');
const trainClient = components(train, 'client', 'Client — Training');
const trainServer = components(train, 'server', 'Server — Training');

console.log('\n########## HOLDOUT WINDOW ##########');
const holdoutClient = components(holdout, 'client', 'Client — Holdout');
const holdoutServer = components(holdout, 'server', 'Server — Holdout');

/** A component only counts as a real lead if it shows the same-sign delta with |t|>=2 in BOTH windows. */
function surviving(trainRows: typeof trainClient, holdoutRows: typeof holdoutClient, label: string) {
  if (!trainRows || !holdoutRows) return;
  console.log(`\n--- ${label}: components surviving train AND holdout (|t|>=2, same sign) ---`);
  let any = false;
  for (const tr of trainRows) {
    const ho = holdoutRows.find(h => h.label === tr.label);
    if (!ho) continue;
    const trSig = !isNaN(tr.t) && Math.abs(tr.t) >= 2;
    const hoSig = !isNaN(ho.t) && Math.abs(ho.t) >= 2;
    const sameSign = Math.sign(tr.delta) === Math.sign(ho.delta) && tr.delta !== 0;
    if (trSig && hoSig && sameSign) {
      console.log(`  ${tr.label.padEnd(36)} train delta ${tr.delta.toFixed(3).padStart(8)} (t=${tr.t.toFixed(2)})  holdout delta ${ho.delta.toFixed(3).padStart(8)} (t=${ho.t.toFixed(2)})`);
      any = true;
    }
  }
  if (!any) console.log('  None. No component\'s effect survived both windows in the same direction.');
}

surviving(trainClient, holdoutClient, 'Client');
surviving(trainServer, holdoutServer, 'Server');

console.log(`
Reading this:
- 'onRate' is how often that component was present/contributing across all
  resolved trades for that source.
- 'avgR|on' vs 'avgR|off' is the real question: did having this factor present
  actually produce a better outcome than not having it?
- Per AUDIT.md's own bar: a component is only a real, trustworthy finding if
  it shows |t| >= ~2 in BOTH training and holdout, with the SAME sign on delta
  (see the 'surviving' section above). Anything else — however clean it looks
  in one window alone — is the same kind of noise that fooled the original 1H
  Price Action finding in item C before holdout caught it.
- Small onRate (e.g. a component only present in 5% of trades) means very few
  data points behind that row even if n looks big overall — treat those rows
  with extra caution regardless of what the numbers say.
`);
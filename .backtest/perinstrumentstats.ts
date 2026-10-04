/**
 * Per-instrument breakdown of the server-vs-client comparison data — same
 * underlying trades as serverVsClientStats.ts, but sliced by instrument
 * instead of by engine/agreement/confidence. Answers: does any instrument
 * actually show a real edge (or a real problem) that's being averaged away
 * when all 12 instruments are pooled together?
 *
 * Reads /tmp/bt/serverVsClient.json (written by serverVsClient.ts).
 */
type Agreement = 'both_same' | 'both_opp' | 'client_only' | 'server_only';
type BItem = { label: string; value: string; weight: number; maxWeight: number; contributing: boolean };
type Rec = {
  id: string; source: 'client' | 'server'; inst: string; dir: 'bullish' | 'bearish'; conf: number;
  genEpoch: number; exitEpoch: number; filled: boolean; base: number | null; cancelled: boolean;
  agreement: Agreement; breakdown: BItem[];
};

const SYNTHETIC_INDICES = ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000'];
const FOREX_INSTRUMENTS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];

const all: Rec[] = JSON.parse(await Bun.file('/tmp/bt/serverVsClient.json').text());
const live = all.filter(r => !r.cancelled && r.filled && r.base !== null);
live.sort((a, b) => a.genEpoch - b.genEpoch);

if (live.length < 20) {
  console.log(`Only ${live.length} resolved trades — too few to break down by instrument meaningfully.`);
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
const tOneSample = (a: number[]) => { if (a.length < 2) return NaN; return mean(a) / (sd(a) / Math.sqrt(a.length)); };

function row(inst: string, g: Rec[]) {
  if (!g.length) return null;
  const r = g.map(x => x.base as number);
  const wr = (g.filter(x => (x.base as number) > 0).length / g.length) * 100;
  const t = tOneSample(r);
  return { inst, n: g.length, wr, avgR: mean(r), t };
}

function printTable(title: string, g: Rec[]) {
  console.log(`\n=== ${title} ===`);
  console.log('instrument'.padEnd(12), 'class'.padEnd(10), 'n'.padStart(4), 'WR'.padStart(7), 'avgR'.padStart(8), 't(vs0)'.padStart(8));
  const insts = [...new Set(g.map(r => r.inst))].sort();
  const rows = insts.map(inst => row(inst, g.filter(r => r.inst === inst))).filter(Boolean) as ReturnType<typeof row>[];
  rows.sort((a, b) => b!.avgR - a!.avgR);
  for (const r of rows) {
    if (!r) continue;
    const cls = SYNTHETIC_INDICES.includes(r.inst) ? 'synthetic' : FOREX_INSTRUMENTS.includes(r.inst) ? 'forex' : '?';
    console.log(
      r.inst.padEnd(12), cls.padEnd(10),
      String(r.n).padStart(4),
      (r.wr.toFixed(1) + '%').padStart(7),
      (r.avgR >= 0 ? '+' : '') + r.avgR.toFixed(3).padStart(7),
      (isNaN(r.t) ? '-' : r.t.toFixed(2)).padStart(8),
    );
  }

  // Forex vs synthetic pooled, for a coarser but more data-rich comparison.
  const forex = g.filter(r => FOREX_INSTRUMENTS.includes(r.inst));
  const synth = g.filter(r => SYNTHETIC_INDICES.includes(r.inst));
  console.log('--- pooled by class ---');
  for (const [label, set] of [['forex+XAU', forex], ['synthetics', synth]] as const) {
    if (!set.length) continue;
    const r = row(label, set)!;
    console.log(label.padEnd(23), String(r.n).padStart(4), (r.wr.toFixed(1) + '%').padStart(7), (r.avgR >= 0 ? '+' : '') + r.avgR.toFixed(3).padStart(7), (isNaN(r.t) ? '-' : r.t.toFixed(2)).padStart(8));
  }
}

for (const source of ['client', 'server'] as const) {
  console.log(`\n########## SOURCE: ${source.toUpperCase()} ##########`);
  printTable(`${source} — Training`, train.filter(r => r.source === source));
  printTable(`${source} — Holdout`, holdout.filter(r => r.source === source));
}

/** Flag instruments whose sign is consistent and |t|>=2 in BOTH windows, for either source. */
console.log('\n########## INSTRUMENTS WORTH A CLOSER LOOK (|t|>=2 in both windows, same sign) ##########');
let anyFound = false;
for (const source of ['client', 'server'] as const) {
  const insts = [...new Set(live.filter(r => r.source === source).map(r => r.inst))];
  for (const inst of insts) {
    const tr = row(inst, train.filter(r => r.source === source && r.inst === inst));
    const ho = row(inst, holdout.filter(r => r.source === source && r.inst === inst));
    if (!tr || !ho) continue;
    const trSig = !isNaN(tr.t) && Math.abs(tr.t) >= 2;
    const hoSig = !isNaN(ho.t) && Math.abs(ho.t) >= 2;
    const sameSign = Math.sign(tr.avgR) === Math.sign(ho.avgR) && tr.avgR !== 0;
    if (trSig && hoSig && sameSign) {
      console.log(`${source.padEnd(8)} ${inst.padEnd(10)} train avgR ${tr.avgR.toFixed(3)} (t=${tr.t.toFixed(2)}, n=${tr.n})  holdout avgR ${ho.avgR.toFixed(3)} (t=${ho.t.toFixed(2)}, n=${ho.n})`);
      anyFound = true;
    }
  }
}
if (!anyFound) console.log('None. No single instrument showed a significant, consistent-sign effect in both windows for either engine.');

console.log(`
Reading this:
- Per-instrument samples are small by construction (12 instruments splitting
  ~235 total trades two ways already, then halved again for train/holdout) —
  expect very wide confidence intervals on any single row. A standout row
  here is a LEAD to investigate with more data, not a strategy to ship.
- The 'pooled by class' rows (forex+XAU vs synthetics) have more data behind
  them and are more trustworthy than any single instrument's row.
- If an instrument looks consistently bad in both windows, that's still only
  weak evidence at this sample size — but worth knowing before featuring it
  prominently in the app, or worth gathering more history on before trusting
  either way.
`);
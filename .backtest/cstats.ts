/** Item C: component-level correlation with realized R, train/holdout split. */
type BItem = { label: string; value: string; weight: number; maxWeight: number; contributing: boolean };
type Rec = {
  id: string; inst: string; type: 'swing' | 'day'; conf: number; genEpoch: number;
  filled: boolean; base: number | null; cancelled: boolean; breakdown: BItem[];
};
const all: Rec[] = JSON.parse(await Bun.file('/tmp/bt/cscore.json').text());
const live = all.filter(r => !r.cancelled && r.filled && r.base !== null);
live.sort((a, b) => a.genEpoch - b.genEpoch);

const epochs = live.map(r => r.genEpoch);
const cut = epochs[Math.floor(epochs.length / 2)];
const train = live.filter(r => r.genEpoch < cut);
const test = live.filter(r => r.genEpoch >= cut);
const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
console.log(`resolved ${live.length} | TRAIN ${train.length} (${d(epochs[0])} -> ${d(cut)}) | HOLDOUT ${test.length} (${d(cut)} -> ${d(epochs[epochs.length - 1])})`);

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

function components(set: Rec[], type: 'swing' | 'day', title: string) {
  const g = set.filter(r => r.type === type);
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

console.log('\n########## TRAINING HALF ONLY ##########');
components(train, 'swing', 'TRAIN swing components');
components(train, 'day', 'TRAIN day components');

const band = (set: Rec[], label: string) => {
  console.log(`\n--- confidence bands: ${label} ---`);
  for (const [l, f] of [['90-100', (c: number) => c >= 90], ['80-89', (c: number) => c >= 80 && c < 90], ['70-79', (c: number) => c >= 70 && c < 80], ['<70', (c: number) => c < 70]] as const) {
    const g = set.filter(r => f(r.conf));
    if (!g.length) continue;
    console.log(l.padEnd(8), `n=${String(g.length).padStart(3)}`, `WR ${(g.filter(r => r.base! > 0).length / g.length * 100).toFixed(1).padStart(5)}%`, `avgR ${mean(g.map(r => r.base!)).toFixed(3)}`);
  }
  console.log('overall  ', `n=${set.length}`, `avgR ${mean(set.map(r => r.base!)).toFixed(3)}`, `corr(conf,R) ${corr(set.map(r => r.conf), set.map(r => r.base!)).toFixed(3)}`);
};
band(train, 'TRAIN (current weights)');
band(test, 'HOLDOUT (current weights)');

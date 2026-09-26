/** Item O addendum: tier significance + component frequency by win/loss. Descriptive; reads /tmp/bt/swingscore.json. */
type BItem = { label: string; weight: number; maxWeight: number };
type Rec = { type: string; cancelled: boolean; filled: boolean; base: number | null; genEpoch: number; unified: number; unifiedTotal: number; breakdown: BItem[] };
const all: Rec[] = JSON.parse(await Bun.file('/tmp/bt/swingscore.json').text());
const sw = all.filter(r => r.type === 'swing' && !r.cancelled && r.filled && r.base !== null).sort((a, b) => a.genEpoch - b.genEpoch);
for (const r of sw) { const s = r.breakdown.reduce((a, b) => a + b.weight, 0); if (Math.abs(s - r.unifiedTotal) > 1e-9) throw new Error('integrity'); }
const cut = sw[Math.floor(sw.length / 2)].genEpoch;
const train = sw.filter(r => r.genEpoch < cut), hold = sw.filter(r => r.genEpoch >= cut);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function lgamma(z: number): number { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let x = z, y = z, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let s = 1.000000000190015; for (const ci of c) s += ci / ++y; return -tmp + Math.log(2.5066282746310005 * s / x); }
function ibeta(x: number, a: number, b: number): number { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); const cf = (x: number, a: number, b: number) => { const qab = a + b, qap = a + 1, qam = a - 1; let c = 1, d = 1 / (1 - qab * x / qap), h = d; for (let m = 1; m <= 200; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 / (1 + aa * d); c = 1 + aa / c; h *= d * c; aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 / (1 + aa * d); c = 1 + aa / c; h *= d * c; } return h; }; return x < (a + 1) / (a + b + 2) ? bt * cf(x, a, b) / a : 1 - bt * cf(1 - x, b, a) / b; }
const pT = (t: number, df: number) => ibeta(df / (df + t * t), df / 2, 0.5);
const wilson = (k: number, n: number) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return `${(100 * (c - h)).toFixed(0)}-${(100 * (c + h)).toFixed(0)}%`; };
const lf = (n: number) => lgamma(n + 1);
const fisher = (a: number, b: number, c: number, d: number) => { const n = a + b + c + d, r1 = a + b, c1 = a + c; const p = (x: number) => Math.exp(lf(r1) + lf(n - r1) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(n - r1 - c1 + x)); const p0 = p(a); let s = 0; for (let x = Math.max(0, r1 + c1 - n); x <= Math.min(r1, c1); x++) { const px = p(x); if (px <= p0 * (1 + 1e-7)) s += px; } return Math.min(1, s); };
const welch = (x: number[], y: number[]) => { const vx = sd(x) ** 2 / x.length, vy = sd(y) ** 2 / y.length, t = (mean(x) - mean(y)) / Math.sqrt(vx + vy), df = (vx + vy) ** 2 / (vx ** 2 / (x.length - 1) + vy ** 2 / (y.length - 1)); return { t, p: pT(t, df) }; };
const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const pear = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; x.forEach((_, i) => { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const f = (n: number, d = 2) => (n >= 0 ? '+' : '') + n.toFixed(d);
function tiers(g: Rec[], cuts: number[], label: string) {
  const b: Rec[][] = cuts.map(() => []); b.push([]);
  for (const r of g) { let i = 0; while (i < cuts.length && r.unified > cuts[i]) i++; b[i].push(r); }
  console.log(`\n${label} (n=${g.length}, upper cuts ${cuts.join('/')})`);
  const names = b.length === 3 ? ['low', 'mid', 'high'] : b.map((_, i) => `Q${i + 1}`);
  b.forEach((x, i) => { if (x.length < 2) return console.log(names[i], 'n=', x.length); const R = x.map(r => r.base!), w = R.filter(v => v > 0).length, s = sd(R), se = s / Math.sqrt(x.length), t = mean(R) / se;
    console.log(`${names[i].padEnd(4)} n=${String(x.length).padStart(3)} W/L ${w}/${x.length - w} win ${(100 * w / x.length).toFixed(1)}% [${wilson(w, x.length)}] meanR ${f(mean(R), 3)} sd ${s.toFixed(2)} se ${se.toFixed(3)} t=${f(t)} p=${pT(t, x.length - 1).toFixed(3)}`); });
  if (b.length === 3) for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) { if (b[i].length < 2 || b[j].length < 2) continue; const w = welch(b[i].map(r => r.base!), b[j].map(r => r.base!)); const wi = b[i].filter(r => r.base! > 0).length, wj = b[j].filter(r => r.base! > 0).length;
    console.log(`  ${names[i]} vs ${names[j]}: Welch t=${f(w.t)} p=${w.p.toFixed(3)} | Fisher win-rate p=${fisher(wi, b[i].length - wi, wj, b[j].length - wj).toFixed(3)}`); }
  const rs = pear(rank(g.map(r => r.unified)), rank(g.map(r => r.base!))), tt = rs * Math.sqrt((g.length - 2) / (1 - rs * rs));
  console.log(`  Spearman(score,R) rho=${f(rs, 3)} t=${f(tt)} p=${pT(tt, g.length - 2).toFixed(3)}`);
}
const q = (g: Rec[], ps: number[]) => { const s = g.map(r => r.unified).sort((a, b) => a - b); return ps.map(p => s[Math.floor(s.length * p) - 1]); };
const T = q(sw, [1 / 3, 2 / 3]);
console.log(`resolved swing ${sw.length}; train ${train.length}, holdout ${hold.length}; breakdown integrity OK`);
tiers(sw, T, 'FULL terciles'); tiers(train, T, 'TRAIN (full cuts)'); tiers(hold, T, 'HOLDOUT (full cuts)');
const TT = q(train, [1 / 3, 2 / 3]); tiers(hold, TT, 'HOLDOUT (train-derived cuts, out-of-sample)');
tiers(sw, q(sw, [.25, .5, .75]), 'FULL quartiles');
console.log('\n=== component frequency (item scored >0), wins vs losses ===');
const W = sw.filter(r => r.base! > 0), L = sw.filter(r => r.base! <= 0);
console.log(`wins ${W.length}, losses ${L.length}. Min reliably detectable gap (80% power, a=.05) ~ ${(100 * 2.8 * Math.sqrt(.25 / W.length + .25 / L.length)).toFixed(0)} pts`);
const val = (r: Rec, lab: string) => r.breakdown.find(b => b.label === lab)?.weight ?? 0;
const on = (g: Rec[], lab: string) => g.filter(r => val(r, lab) > 0).length;
const rate = (g: Rec[], lab: string) => on(g, lab) / (g.length || 1);
const labs = [...new Set(sw.flatMap(r => r.breakdown.map(b => b.label)))];
const rows = labs.map(lab => ({ lab, w: on(W, lab), l: on(L, lab), pw: mean(W.map(r => val(r, lab))), pl: mean(L.map(r => val(r, lab))),
  tg: 100 * (rate(train.filter(r => r.base! > 0), lab) - rate(train.filter(r => r.base! <= 0), lab)),
  hg: 100 * (rate(hold.filter(r => r.base! > 0), lab) - rate(hold.filter(r => r.base! <= 0), lab)) })).sort((a, b) => b.w - a.w);
for (const r of rows) { const gap = 100 * (r.w / W.length - r.l / L.length), all = (r.w + r.l) / sw.length;
  console.log(`${r.lab.padEnd(40)} W ${String(r.w).padStart(2)}/${W.length} ${(100 * r.w / W.length).toFixed(0).padStart(3)}% | L ${String(r.l).padStart(2)}/${L.length} ${(100 * r.l / L.length).toFixed(0).padStart(3)}% | gap ${f(gap, 0).padStart(4)} | pts ${r.pw.toFixed(2)}/${r.pl.toFixed(2)} | tr/ho ${f(r.tg, 0)}/${f(r.hg, 0)}${all >= .9 ? ' [near-always]' : all <= .05 ? ' [rare]' : ''}`); }

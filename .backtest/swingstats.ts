/**
 * Swing confidence study (post-unification). Separate from the earlier item-C null.
 * - Score-level: legacy app score vs 29-item vote vs unified canonical score, corr with realised R.
 * - Component-level: every unified item, train/holdout chronological split.
 */
type BItem = { label: string; value: string; weight: number; maxWeight: number; contributing: boolean };
type Rec = {
  id: string; inst: string; type: 'swing' | 'day'; conf: number; genEpoch: number; filled: boolean;
  base: number | null; cancelled: boolean; breakdown: BItem[];
  legacy: number; vote: number; voteMax: number; unified: number; unifiedTotal: number;
};
const all: Rec[] = JSON.parse(await Bun.file('/tmp/bt/swingscore.json').text());
const sw = all.filter(r => r.type === 'swing' && !r.cancelled && r.filled && r.base !== null).sort((a, b) => a.genEpoch - b.genEpoch);
const cut = sw[Math.floor(sw.length / 2)].genEpoch;
const train = sw.filter(r => r.genEpoch < cut), hold = sw.filter(r => r.genEpoch >= cut);
const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const corr = (x: number[], y: number[]) => {
  const n = x.length, mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { const p = x[i] - mx, q = y[i] - my; a += p * q; b += p * p; c += q * q; }
  return b && c ? a / Math.sqrt(b * c) : NaN;
};
const t = (r: number, n: number) => r * Math.sqrt((n - 2) / (1 - r * r));
const fmt = (r: number, n: number) => isNaN(r) ? 'const' : `r=${r >= 0 ? '+' : ''}${r.toFixed(3)} t=${t(r, n) >= 0 ? '+' : ''}${t(r, n).toFixed(2)}`;

console.log(`swing resolved ${sw.length} | train ${train.length} (${d(sw[0].genEpoch)}→${d(cut)}) | holdout ${hold.length} (→${d(sw[sw.length - 1].genEpoch)})`);
console.log(`generated swing (incl. unfilled/cancelled): ${all.filter(r => r.type === 'swing').length}`);

console.log('\n--- integrity ---');
const over = all.filter(r => r.type === 'swing' && r.unifiedTotal > 46).length;
const capU = sw.filter(r => r.unified >= 95).length, capL = sw.filter(r => r.legacy >= 95).length;
console.log(`unified total > max: ${over} | at 95 cap: unified ${capU}, legacy ${capL}`);
console.log(`vote max per signal: ${[...new Set(sw.map(r => r.voteMax))].join(',')}`);
console.log(`corr(legacy, unified) = ${corr(sw.map(r => r.legacy), sw.map(r => r.unified)).toFixed(3)} | corr(vote, unified) = ${corr(sw.map(r => r.vote), sw.map(r => r.unified)).toFixed(3)}`);
const q = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return `min ${s[0]} p25 ${s[Math.floor(s.length * .25)]} med ${s[Math.floor(s.length / 2)]} p75 ${s[Math.floor(s.length * .75)]} max ${s[s.length - 1]}`; };
console.log(`legacy dist:  ${q(sw.map(r => r.legacy))}`);
console.log(`unified dist: ${q(sw.map(r => r.unified))}`);

console.log('\n--- score-level corr with realised R ---');
for (const [name, f] of [['legacy app score', (r: Rec) => r.legacy], ['29-item vote', (r: Rec) => r.vote / r.voteMax], ['unified canonical', (r: Rec) => r.unified]] as const) {
  console.log(name.padEnd(20), 'train', fmt(corr(train.map(f), train.map(r => r.base!)), train.length).padEnd(22),
    'holdout', fmt(corr(hold.map(f), hold.map(r => r.base!)), hold.length).padEnd(22),
    'full', fmt(corr(sw.map(f), sw.map(r => r.base!)), sw.length));
}

console.log('\n--- unified confidence terciles (full) ---');
const byU = [...sw].sort((a, b) => a.unified - b.unified); const k = Math.floor(byU.length / 3);
for (const [n, g] of [['low', byU.slice(0, k)], ['mid', byU.slice(k, 2 * k)], ['high', byU.slice(2 * k)]] as const)
  console.log(n.padEnd(5), `n=${g.length} conf ${g[0].unified}-${g[g.length - 1].unified} win ${(100 * g.filter(r => r.base! > 0).length / g.length).toFixed(1)}% avgR ${mean(g.map(r => r.base!)).toFixed(3)}`);

console.log('\n--- unified components: train | holdout ---');
const labels = [...new Set(sw.flatMap(r => r.breakdown.map(b => b.label)))];
for (const L of labels) {
  const row = (g: Rec[]) => { const w = g.map(r => r.breakdown.find(b => b.label === L)?.weight ?? 0); return { c: corr(w, g.map(r => r.base!)), n: g.length, on: w.filter(x => x > 0).length / g.length }; };
  const a = row(train), b = row(hold);
  const flag = !isNaN(a.c) && !isNaN(b.c) && Math.abs(t(a.c, a.n)) >= 2 && Math.abs(t(b.c, b.n)) >= 2 && Math.sign(a.c) === Math.sign(b.c) ? '  <-- replicates' : '';
  console.log(L.padEnd(34), fmt(a.c, a.n).padEnd(22), `on ${(a.on * 100).toFixed(0)}%`.padEnd(8), '|', fmt(b.c, b.n).padEnd(22), `on ${(b.on * 100).toFixed(0)}%${flag}`);
}

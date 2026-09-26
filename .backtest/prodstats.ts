type Rec = {
  id: string; inst: string; type: 'swing' | 'day'; dir: string; conf: number; month: string;
  filled: boolean; base: number | null; nospread: number | null; w15: number | null; w20: number | null;
  mfe: number; mae: number; spreadRiskPct: number; cancelled: boolean;
};
const all: Rec[] = JSON.parse(await Bun.file('/tmp/bt/prod.json').text());
const live = all.filter(r => !r.cancelled && r.filled && r.base !== null);

const f = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(3);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const tstat = (a: number[]) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  return m / (sd / Math.sqrt(a.length));
};
const row = (label: string, g: Rec[]) => {
  if (!g.length) return;
  const r = g.map(x => x.base as number);
  console.log(
    label.padEnd(14), `n=${String(g.length).padStart(4)}`,
    `WR ${(g.filter(x => (x.base as number) > 0).length / g.length * 100).toFixed(1).padStart(5)}%`,
    `avgR ${f(mean(r))}`, `netR ${f(r.reduce((a, b) => a + b, 0)).padStart(8)}`,
    `t=${tstat(r).toFixed(2)}`,
  );
};

console.log('=== PRODUCTION-ARBITER BASELINE (12 months) ===');
console.log('generated', all.length, '| cancelled by reversal', all.filter(r => r.cancelled).length,
  '| never filled', all.filter(r => !r.cancelled && !r.filled).length,
  '| unresolved', all.filter(r => !r.cancelled && r.filled && r.base === null).length,
  '| resolved', live.length);
row('ALL', live);
const t = tstat(live.map(r => r.base as number));
console.log(`t-stat ${t.toFixed(3)} | 95% CI on avg R: ${(mean(live.map(r=>r.base as number))).toFixed(3)} +/- ${(1.96 * Math.sqrt(live.map(r=>r.base as number).reduce((s,x)=>s+(x-mean(live.map(y=>y.base as number)))**2,0)/(live.length-1))/Math.sqrt(live.length)).toFixed(3)}`);

console.log('\n=== BY CONFIDENCE BAND ===');
for (const [l, fn] of [['90-100', (c: number) => c >= 90], ['80-89', (c: number) => c >= 80 && c < 90], ['70-79', (c: number) => c >= 70 && c < 80], ['60-69', (c: number) => c >= 60 && c < 70], ['<60', (c: number) => c < 60]] as const)
  row(l, live.filter(r => fn(r.conf)));

console.log('\n=== BY TRADE TYPE ===');
row('swing', live.filter(r => r.type === 'swing'));
row('day', live.filter(r => r.type === 'day'));

console.log('\n=== BY INSTRUMENT ===');
for (const i of [...new Set(live.map(r => r.inst))].sort()) row(i, live.filter(r => r.inst === i));
row('FOREX', live.filter(r => r.inst.includes('/')));
row('SYNTH', live.filter(r => !r.inst.includes('/')));

console.log('\n=== BY MONTH ===');
for (const m of [...new Set(live.map(r => r.month))].sort()) row(m, live.filter(r => r.month === m));

console.log('\n=== V50 COST ISOLATION ===');
const variants = (label: string, g: Rec[]) => {
  if (!g.length) return;
  const pick = (k: 'base' | 'nospread' | 'w15' | 'w20') => g.map(x => x[k]).filter(v => v !== null) as number[];
  const b = pick('base'), ns = pick('nospread'), a = pick('w15'), c = pick('w20');
  console.log(label.padEnd(14), `n=${String(g.length).padStart(3)}`,
    `base ${f(mean(b))} (t=${tstat(b).toFixed(2)})`,
    `| nospread ${f(mean(ns))}`, `| stop1.5x ${f(mean(a))}`, `| stop2.0x ${f(mean(c))}`,
    `| spread/risk ${mean(g.map(x => x.spreadRiskPct)).toFixed(1)}%`,
    `| MFE ${mean(g.map(x => x.mfe)).toFixed(2)}R`);
};
variants('V50 all', live.filter(r => r.inst === 'V50'));
variants('V50 day', live.filter(r => r.inst === 'V50' && r.type === 'day'));
variants('V50 swing', live.filter(r => r.inst === 'V50' && r.type === 'swing'));
variants('SYNTH', live.filter(r => !r.inst.includes('/')));
variants('FOREX', live.filter(r => r.inst.includes('/')));
variants('ALL', live);

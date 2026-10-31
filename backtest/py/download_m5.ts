/**
 * Downloads M5 (or M1) candles from Deriv's public feed into a CSV for the Python
 * backtester: columns time_utc (ISO, candle OPEN time, UTC), open, high, low, close.
 *
 *   bun run .\backtest\py\download_m5.ts OTC_NDX NAS100 400 [granularity=300]
 *
 * args: Deriv symbol, output name (backtest/py/data/<name>_M5.csv), days back.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [symbol, name, daysArg, granArg] = process.argv.slice(2);
if (!symbol || !name) throw new Error('usage: download_m5.ts <deriv symbol> <name> [days=400] [granularity=300]');
const days = Number(daysArg ?? 400), gran = Number(granArg ?? 300);
const startLimit = Math.floor(Date.now() / 1000) - days * 86400;

const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
let id = 0;
const pending = new Map<number, (d: any) => void>();
ws.onmessage = e => { const d = JSON.parse(String(e.data)); pending.get(d.req_id)?.(d); pending.delete(d.req_id); };
await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('connect failed')); });
const call = (end: number | 'latest') => new Promise<any>((res) => {
  const r = ++id;
  const t = setTimeout(() => { pending.delete(r); res({ error: { code: 'Timeout' } }); }, 30000);
  pending.set(r, d => { clearTimeout(t); res(d); });
  ws.send(JSON.stringify({ ticks_history: symbol, style: 'candles', granularity: gran, count: 5000, end, adjust_start_time: 1, req_id: r }));
});

const label = gran === 60 ? 'M1' : gran === 300 ? 'M5' : `G${gran}`;
const file = `./backtest/py/data/${name}_${label}.csv`;
const out = new Map<number, number[]>();
let end: number | 'latest' = 'latest';
// Resume: keep what an earlier (rate-limited) run saved and continue further back.
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1)) {
    const [t, o, h, l, c] = line.split(',');
    out.set(Math.floor(Date.parse(t) / 1000), [+o, +h, +l, +c]);
  }
  if (out.size) { end = Math.min(...out.keys()) - 1; console.log(`resuming before ${new Date((end + 1) * 1000).toISOString()} (${out.size} saved)`); }
}
for (let page = 1; page <= 200; page++) {
  let d: any = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    d = await call(end);
    if (d?.candles?.length) break;
    console.log(`  page ${page}: retry ${attempt} (${d?.error?.code ?? 'no candles'})`);
    await new Promise(r => setTimeout(r, 20000 * attempt)); // Deriv RateLimit needs a long pause
  }
  if (!d?.candles?.length) break;
  for (const c of d.candles) out.set(c.epoch, [+c.open, +c.high, +c.low, +c.close]);
  const first = d.candles[0].epoch;
  console.log(`  page ${page}: ${d.candles.length} candles from ${new Date(first * 1000).toISOString()}`);
  if (first <= startLimit) break;
  end = first - 1;
  await new Promise(r => setTimeout(r, 1500)); // stay under the rate limit
}
ws.close();

const rows = [...out.entries()].filter(([e]) => e >= startLimit).sort((a, b) => a[0] - b[0]);
mkdirSync('./backtest/py/data', { recursive: true });
writeFileSync(file,
  'time_utc,open,high,low,close\n' + rows.map(([e, v]) => `${new Date(e * 1000).toISOString()},${v.join(',')}`).join('\n') + '\n');
console.log(`${name}: ${rows.length} candles, ${new Date(rows[0][0] * 1000).toISOString()} → ${new Date(rows.at(-1)![0] * 1000).toISOString()}`);
process.exit(0);

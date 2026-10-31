/** Latest ~5000 H1 candles from Deriv for the forward test: bun run dl_h1_latest.ts */
import { writeFileSync } from 'node:fs';
const SYMS: Record<string, string> = { frxXAUUSD: 'XAUUSD', frxEURUSD: 'EURUSD', frxAUDUSD: 'AUDUSD', frxGBPUSD: 'GBPUSD', frxUSDJPY: 'USDJPY', cryBTCUSD: 'BTCUSD' };
const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
const res: Record<number, any> = {};
ws.onmessage = e => { const d = JSON.parse(String(e.data)); res[d.req_id] = d; };
await new Promise(r => (ws.onopen = r));
let id = 0;
for (const [sym, name] of Object.entries(SYMS)) {
  const r = ++id;
  ws.send(JSON.stringify({ ticks_history: sym, style: 'candles', granularity: 3600, count: 5000, end: 'latest', req_id: r }));
  for (let t = 0; t < 60 && !res[r]; t++) await new Promise(x => setTimeout(x, 500));
  const c = (res[r]?.candles ?? []).filter((x: any) => x.epoch % 3600 === 0);
  writeFileSync(`./data/ext/${name}_deriv_H1.csv`, 'time_utc,open,high,low,close\n' +
    c.map((x: any) => `${new Date(x.epoch * 1000).toISOString()},${x.open},${x.high},${x.low},${x.close}`).join('\n') + '\n');
  console.log(name, c.length, c.length ? new Date(c[0].epoch * 1000).toISOString() + ' .. ' + new Date(c.at(-1).epoch * 1000).toISOString() : res[r]?.error?.code);
  await new Promise(x => setTimeout(x, 1500));
}
process.exit(0);

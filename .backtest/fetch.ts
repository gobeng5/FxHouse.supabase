/** Refetch 12 months of D1/4H/1H candles for all instruments into /tmp/bt/data.json */
const MAP: Record<string, string> = {
  'EUR/USD': 'frxEURUSD', 'GBP/USD': 'frxGBPUSD', 'USD/JPY': 'frxUSDJPY',
  'AUD/USD': 'frxAUDUSD', 'GBP/JPY': 'frxGBPJPY', 'XAU/USD': 'frxXAUUSD',
  'V10': 'R_10', 'V25': 'R_25', 'V50': 'R_50', 'V75': 'R_75', 'V100': 'R_100', 'BOOM1000': 'BOOM1000',
};
type C = { epoch: number; open: number; high: number; low: number; close: number };

const URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
let ws: WebSocket | null = null;
let id = 0;
const pending = new Map<number, (v: any) => void>();

async function connect() {
  ws = new WebSocket(URL);
  pending.clear();
  ws.onmessage = e => {
    const m = JSON.parse(e.data as string);
    const rid = Number(m.req_id ?? m.echo_req?.req_id);
    const fn = pending.get(rid);
    if (fn) { pending.delete(rid); fn(m); }
  };
  ws.onclose = () => { ws = null; };
  ws.onerror = () => { try { ws?.close(); } catch {} ws = null; };
  await new Promise<void>((r, j) => {
    const t = setTimeout(() => j(new Error('open timeout')), 15000);
    ws!.onopen = () => { clearTimeout(t); r(); };
  });
}

async function call(payload: any): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!ws || ws.readyState !== 1) { try { await connect(); } catch { await Bun.sleep(1500); continue; } }
    const rid = ++id;
    const res = await new Promise<any>(r => {
      const t = setTimeout(() => { pending.delete(rid); r(null); }, 20000);
      pending.set(rid, v => { clearTimeout(t); r(v); });
      try { ws!.send(JSON.stringify({ ...payload, req_id: rid })); } catch { clearTimeout(t); pending.delete(rid); r(null); }
    });
    if (res) return res;
    try { ws?.close(); } catch {}
    ws = null;
    await Bun.sleep(1000);
  }
  return {};
}

async function series(sym: string, gran: number, months = 12): Promise<C[]> {
  const now = Math.floor(Date.now() / 1000);
  const startLimit = now - months * 30 * 86400;
  let end: number | string = 'latest';
  const out: C[] = [];
  for (let i = 0; i < 40; i++) {
    let r: any = {};
    for (let k = 0; k < 30; k++) {
      r = await call({ ticks_history: sym, style: 'candles', granularity: gran, count: 1000, end, adjust_start_time: 1 });
      if (r?.error?.code === 'RateLimit' || !r?.candles) { console.error(sym, gran, 'retry', r?.error?.code ?? 'no candles'); await Bun.sleep(20000); continue; }
      break;
    }
    if (r?.error) throw new Error(`${sym} ${gran}: ${r.error.code} ${r.error.message}`);
    const cs: C[] = (r.candles || []).map((c: any) => ({
      epoch: c.epoch, open: +c.open, high: +c.high, low: +c.low, close: +c.close,
    }));
    if (!cs.length) break;
    out.unshift(...cs);
    const first = cs[0].epoch;
    if (first <= startLimit) break;
    end = first - 1;
    await Bun.sleep(1200);
  }
  const seen = new Set<number>();
  return out.filter(c => c.epoch >= startLimit && !seen.has(c.epoch) && seen.add(c.epoch))
            .sort((a, b) => a.epoch - b.epoch);
}

const data: Record<string, { h1: C[]; h4: C[]; d1: C[] }> = {};
for (const [inst, sym] of Object.entries(MAP)) {
  const h1 = await series(sym, 3600);
  const h4 = await series(sym, 14400);
  const d1 = await series(sym, 86400);
  data[inst] = { h1, h4, d1 };
  console.log(inst, 'h1', h1.length, 'h4', h4.length, 'd1', d1.length);
}
for (const [k, v] of Object.entries(data)) if (!v.h1.length || !v.h4.length || !v.d1.length) throw new Error(`refusing to save: ${k} incomplete`);
await Bun.write('/tmp/bt/data.json', JSON.stringify(data));
try { ws?.close(); } catch {}
console.log('saved');

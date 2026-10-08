/**
 * FxHouse — Deriv Historical Candle Downloader
 *
 * Downloads approximately 12 months of:
 *   M15, H1, H4, D1
 *
 * for all instruments used by the signal engine.
 *
 * Output:
 *   .\backtest\data.json
 *
 * Run with:
 *   bun run .\backtest\download-data.ts
 */

const MAP: Record<string, string> = {
  'EUR/USD': 'frxEURUSD',
  'GBP/USD': 'frxGBPUSD',
  'USD/JPY': 'frxUSDJPY',
  'AUD/USD': 'frxAUDUSD',
  'GBP/JPY': 'frxGBPJPY',
  'XAU/USD': 'frxXAUUSD',
  'V10': 'R_10',
  'V25': 'R_25',
  'V50': 'R_50',
  'V75': 'R_75',
  'V100': 'R_100',
  'BOOM1000': 'BOOM1000',
};

type Candle = {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Timeframe = {
  granularity: number;
  key: 'm15' | 'h1' | 'h4' | 'd1';
};

const TIMEFRAMES: Timeframe[] = [
  { key: 'm15', granularity: 900 },
  { key: 'h1', granularity: 3600 },
  { key: 'h4', granularity: 14400 },
  { key: 'd1', granularity: 86400 },
];

// Current Deriv public market-data WebSocket.
// Historical market data does not require authentication.
const URL =
  'wss://api.derivws.com/trading/v1/options/ws/public';

const OUTPUT = './backtest/data.json';

// 12 months ≈ 365 days.
// We deliberately use a fixed UTC window so the backtest is reproducible.
const START_LIMIT =
  Math.floor(Date.now() / 1000) - 365 * 86400;

let ws: WebSocket | null = null;
let requestId = 0;

const pending = new Map<
  number,
  (value: any) => void
>();

async function connect(): Promise<void> {
  if (ws && ws.readyState === 1) return;

  ws = new WebSocket(URL);

  pending.clear();

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(
        event.data as string
      );

      const id = Number(
        message.req_id ??
        message.echo_req?.req_id
      );

      const resolver = pending.get(id);

      if (resolver) {
        pending.delete(id);
        resolver(message);
      }
    } catch (error) {
      console.error(
        'Failed to parse WebSocket message:',
        error
      );
    }
  };

  ws.onclose = () => {
    ws = null;
  };

  ws.onerror = () => {
    try {
      ws?.close();
    } catch {}

    ws = null;
  };

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          'WebSocket connection timeout'
        )
      );
    }, 15000);

    ws!.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
}

async function call(
  payload: Record<string, unknown>
): Promise<any> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      if (!ws || ws.readyState !== 1) {
        await connect();
      }

      const reqId = ++requestId;

      const result = await new Promise<any>(
        (resolve) => {
          const timeout = setTimeout(() => {
            pending.delete(reqId);
            resolve(null);
          }, 20000);

          pending.set(reqId, (value) => {
            clearTimeout(timeout);
            resolve(value);
          });

          try {
            ws!.send(
              JSON.stringify({
                ...payload,
                req_id: reqId,
              })
            );
          } catch {
            clearTimeout(timeout);
            pending.delete(reqId);
            resolve(null);
          }
        }
      );

      if (result) {
        return result;
      }
    } catch (error) {
      console.error(
        `Request attempt ${attempt} failed:`,
        error
      );
    }

    try {
      ws?.close();
    } catch {}

    ws = null;

    await Bun.sleep(
      Math.min(3000 * attempt, 10000)
    );
  }

  return {};
}

async function downloadSeries(
  instrument: string,
  symbol: string,
  granularity: number
): Promise<Candle[]> {
  const output: Candle[] = [];

  let end: number | string = 'latest';

  console.log(
    `\n${instrument} | ${granularity}s`
  );

  for (let page = 1; page <= 100; page++) {
    let response: any = null;

    for (let retry = 1; retry <= 5; retry++) {
      response = await call({
        ticks_history: symbol,
        style: 'candles',
        granularity,
        count: 1000,
        end,
        adjust_start_time: 1,
        subscribe: 1,
      });

      if (
        response?.candles &&
        response.candles.length > 0
      ) {
        break;
      }

      const code =
        response?.error?.code ??
        'NO_CANDLES';

      console.log(
        `  page ${page}: retry ${retry} (${code})`
      );

      await Bun.sleep(
        Math.min(5000 * retry, 20000)
      );
    }

    if (response?.error) {
      throw new Error(
        `${instrument} ${granularity}: ` +
        `${response.error.code} ` +
        `${response.error.message}`
      );
    }

    const candles: Candle[] =
      (response?.candles ?? []).map(
        (c: any) => ({
          epoch: Number(c.epoch),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        })
      );

    if (!candles.length) {
      break;
    }

    output.unshift(...candles);

    // Forget the live subscription before requesting the next historical page.
    const subscriptionId =
      response?.subscription?.id ??
      response?.subscription?.subscription_id;

    if (subscriptionId) {
      await call({
        forget: subscriptionId,
      });
    }
    const firstEpoch =
      candles[0].epoch;

    console.log(
      `  page ${page}: +${candles.length} candles`
    );

    if (firstEpoch <= START_LIMIT) {
      break;
    }

    end = firstEpoch - 1;

    // Stay comfortably below API rate limits.
    await Bun.sleep(1200);
  }

  // Remove duplicates.
  const seen = new Set<number>();

  const cleaned = output
    .filter((candle) => {
      if (
        candle.epoch < START_LIMIT
      ) {
        return false;
      }

      if (seen.has(candle.epoch)) {
        return false;
      }

      seen.add(candle.epoch);
      return true;
    })
    .sort(
      (a, b) =>
        a.epoch - b.epoch
    );

  console.log(
    `  TOTAL: ${cleaned.length} candles`
  );

  return cleaned;
}

type InstrumentData = {
  m15: Candle[];
  h1: Candle[];
  h4: Candle[];
  d1: Candle[];
};

const data: Record<
  string,
  InstrumentData
> = {};

console.log(
  '=========================================='
);
console.log(
  ' FxHouse Historical Candle Downloader'
);
console.log(
  '=========================================='
);
console.log(
  `Start epoch: ${START_LIMIT}`
);
console.log(
  `Output: ${OUTPUT}`
);
console.log(
  ''
);

for (const [instrument, symbol] of Object.entries(
  MAP
)) {
  console.log(
    `\n==========================================`
  );
  console.log(
    ` ${instrument} (${symbol})`
  );
  console.log(
    `==========================================`
  );

  const result = {} as InstrumentData;

  for (const timeframe of TIMEFRAMES) {
    result[timeframe.key] =
      await downloadSeries(
        instrument,
        symbol,
        timeframe.granularity
      );

    // Small pause between timeframes.
    await Bun.sleep(1500);
  }

  data[instrument] = result;
}

// Validate every instrument.
for (const [instrument, series] of Object.entries(
  data
)) {
  for (const timeframe of TIMEFRAMES) {
    const candles =
      series[timeframe.key];

    if (!candles.length) {
      throw new Error(
        `REFUSING TO SAVE: ${instrument} ` +
        `${timeframe.key} has no candles`
      );
    }
  }
}

// Ensure output directory exists.
await Bun.write(
  OUTPUT,
  JSON.stringify(data, null, 2)
);

// Summary.
console.log(
  '\n=========================================='
);
console.log(
  ' DOWNLOAD COMPLETE'
);
console.log(
  '=========================================='
);

for (const [instrument, series] of Object.entries(
  data
)) {
  console.log(
    `${instrument.padEnd(10)} ` +
    `M15=${series.m15.length} ` +
    `H1=${series.h1.length} ` +
    `H4=${series.h4.length} ` +
    `D1=${series.d1.length}`
  );
}

try {
  ws?.close();
} catch {}

console.log(
  `\nSaved raw candle data to: ${OUTPUT}`
);








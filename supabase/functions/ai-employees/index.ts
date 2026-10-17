import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { evaluateLiveSetups, LIVE_INSTRUMENTS } from '../_shared/analysis/liveStrategies.ts';
import type { LiveCandles } from '../_shared/analysis/liveStrategies.ts';
import { maxHoldHours } from '../_shared/analysis/holdLimits.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The function spends DeepSeek credits and sends a Telegram digest, so it only
// runs for: the scheduled job (shared secret), service-role callers, or a
// signed-in admin user.
async function isAuthorized(req: Request, supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const cronSecret = Deno.env.get('AI_EMPLOYEES_CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) return true;

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return true;

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return false;
  const { data } = await supabase.from('user_settings').select('is_admin').eq('user_id', user.id).maybeSingle();
  return data?.is_admin === true;
}

// --- DeepSeek ---
// Model names deepseek-chat / deepseek-reasoner are being retired; use the
// current v4 family. Flash is the fast/cheap tier — the right fit for
// frequent background workers like these. Check https://api-docs.deepseek.com
// if this model id ever starts erroring as deprecated.
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

// Throws instead of returning a placeholder: a missing key or an empty reply
// must surface as an 'error' desk, never as a finished report.
async function callDeepSeek(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured — set it as a Supabase secret.');

  // The model spends part of this budget thinking before it writes, so a
  // tight limit can leave nothing for the reply itself.
  let maxTokens = 1500;
  let finishReason = 'unknown';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = (data.choices?.[0]?.message?.content ?? '').trim();
    if (content) return content;

    // An empty reply cut off by the token limit gets one retry with more room.
    finishReason = data.choices?.[0]?.finish_reason ?? 'unknown';
    if (finishReason === 'length') maxTokens *= 2;
  }

  throw new Error(`DeepSeek returned an empty reply (finish_reason: ${finishReason}).`);
}

// --- Desk/log helpers ---
async function setWorking(supabase: ReturnType<typeof createClient>, id: string, task: string) {
  await supabase.from('ai_employee_activity').update({
    status: 'working', current_task: task, started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('employee_id', id);
}

async function setDone(supabase: ReturnType<typeof createClient>, id: string, task: string, report: string) {
  await supabase.from('ai_employee_activity').update({
    status: 'done', current_task: task, last_report: report, updated_at: new Date().toISOString(),
  }).eq('employee_id', id);
  await supabase.from('ai_employee_logs').insert({ employee_id: id, task, status: 'done', output: report });
}

async function setError(supabase: ReturnType<typeof createClient>, id: string, task: string, message: string) {
  await supabase.from('ai_employee_activity').update({
    status: 'error', current_task: task, last_report: message, updated_at: new Date().toISOString(),
  }).eq('employee_id', id);
  await supabase.from('ai_employee_logs').insert({ employee_id: id, task, status: 'error', output: message });
}

// --- Kofi: security ---
async function runKofi(supabase: ReturnType<typeof createClient>) {
  const task = 'Security sweep';
  await setWorking(supabase, 'kofi', task);
  try {
    const { data: rlsRows, error: rlsErr } = await supabase.rpc('security_rls_audit');
    if (rlsErr) throw rlsErr;
    const noRls = (rlsRows ?? []).filter((r: any) => !r.rls_enabled);
    const noPolicies = (rlsRows ?? []).filter((r: any) => r.rls_enabled && Number(r.policy_count) === 0);

    // Despite its name, this RPC reads pg_net's response log: the scheduled
    // calls from the database to the edge functions, not Telegram sends.
    // Telegram delivery is Ama's check (generated_signals.telegram_status).
    const { data: httpRows, error: httpErr } = await supabase.rpc('recent_telegram_http_responses', { lookback_minutes: 180 });
    const failed = (httpRows ?? []).filter((r: any) => r.status_code && r.status_code >= 400);
    const timedOut = (httpRows ?? []).filter((r: any) => r.timed_out);

    const facts = [
      `Tables with RLS disabled: ${noRls.length ? noRls.map((r: any) => r.table_name).join(', ') : 'none'}`,
      `Tables with RLS enabled but zero policies (effectively locked to everyone, including owners via PostgREST): ${noPolicies.length ? noPolicies.map((r: any) => r.table_name).join(', ') : 'none'}`,
      httpErr
        ? `Scheduled calls to the edge functions: log unavailable (${httpErr.message})`
        : `Scheduled calls to the edge functions in the last 3h: ${httpRows?.length ?? 0} logged, ${failed.length} with a 4xx/5xx status, ${timedOut.length} timed out`,
    ].join('\n');

    const report = await callDeepSeek(
      'You are Kofi, the security officer for a small trading-signals app. Report findings plainly, in under 120 words, no filler. If everything is clean, say so briefly — do not pad a clean report with caveats.',
      `Here is what I checked just now:\n${facts}\n\nWrite the report.`,
    );
    await setDone(supabase, 'kofi', task, report);
  } catch (err) {
    await setError(supabase, 'kofi', task, err instanceof Error ? err.message : 'Unknown error');
  }
}

// --- Ama: signal-engine job + Telegram delivery QA ---
const AMA_LOOKBACK_HOURS = 24;
// Hourly engine runs Ama replays against the live rules (the 6h between her runs).
const AMA_REPLAY_HOURS = 6;

const DERIV_SYMBOLS: Record<string, string> = {
  'EUR/USD': 'frxEURUSD', 'GBP/USD': 'frxGBPUSD', 'USD/JPY': 'frxUSDJPY', 'AUD/USD': 'frxAUDUSD',
  'GBP/JPY': 'frxGBPJPY', 'XAU/USD': 'frxXAUUSD', V10: 'R_10', V75: 'R_75',
};

/** Recent candles for each live instrument from Deriv's public feed, one socket for all requests. */
async function fetchLiveCandles(): Promise<Map<string, LiveCandles>> {
  const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
  const pending = new Map<number, (d: any) => void>();
  ws.onmessage = (e: MessageEvent) => { const d = JSON.parse(String(e.data)); pending.get(d.req_id)?.(d); pending.delete(d.req_id); };
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('Deriv connection failed')); });
  let id = 0;
  const get = (symbol: string, granularity: number, count: number) => new Promise<any[]>((resolve, reject) => {
    const req = ++id;
    const timer = setTimeout(() => reject(new Error(`Deriv timeout for ${symbol}`)), 15000);
    pending.set(req, d => { clearTimeout(timer); d.error ? reject(new Error(`${symbol}: ${d.error.message}`)) : resolve(d.candles ?? []); });
    ws.send(JSON.stringify({ ticks_history: symbol, adjust_start_time: 1, count, end: 'latest', granularity, style: 'candles', req_id: req }));
  });
  try {
    const out = new Map<string, LiveCandles>();
    for (const inst of LIVE_INSTRUMENTS) {
      const s = DERIV_SYMBOLS[inst];
      // Generous windows: the replay asks what the rules should have produced, so a
      // too-short engine fetch shows up as a miss instead of being reproduced.
      const [d1, h4, h1, m15] = await Promise.all([get(s, 86400, 400), get(s, 14400, 400), get(s, 3600, 500), get(s, 900, 500)]);
      out.set(inst, { d1, h4, h1, m15 });
    }
    return out;
  } finally {
    try { ws.close(); } catch { /* noop */ }
  }
}

type TelegramSettings = { telegram_enabled?: boolean; telegram_bot_token?: string; telegram_chat_id?: string } | null;

// Sent straight away when Ama runs on her own and finds a problem, instead of
// waiting for the next daily digest. Returns a line for her report.
async function sendAmaAlert(supabase: ReturnType<typeof createClient>, settings: TelegramSettings, text: string): Promise<string> {
  if (!settings?.telegram_enabled || !settings.telegram_bot_token || !settings.telegram_chat_id) {
    return 'Alert: not sent (Telegram is disabled or not configured).';
  }
  const { data, error } = await supabase.functions.invoke('send-telegram', {
    body: {
      action: 'send',
      bot_token: settings.telegram_bot_token,
      chat_id: settings.telegram_chat_id,
      message: `🚨 *Ama: signal pipeline problem*\n\n${text.replace(/[_*`\[\]]/g, '')}`,
    },
  });
  if (error || !data?.success) return `Alert: Telegram delivery FAILED — ${data?.error ?? error?.message ?? 'unknown error'}`;
  return `Alert: sent to Telegram (message ${data.message_id ?? 'id unknown'}).`;
}

/** `alertSettings` is set only for Ama-only runs; the full daily run reports through Boss's digest. */
async function runAma(supabase: ReturnType<typeof createClient>, alertSettings: TelegramSettings = null) {
  const task = 'Signal & Telegram QA';
  await setWorking(supabase, 'ama', task);

  try {
    const since = new Date(Date.now() - AMA_LOOKBACK_HOURS * 3600 * 1000).toISOString();

    const { data: signals, error: sigErr } = await supabase
      .from('generated_signals')
      .select(
        'id, user_id, instrument, trade_type, setup_type, confidence, engine_generated, created_at, telegram_status, telegram_message_id, telegram_error'
      )
      .gte('created_at', since)
      .eq('engine_generated', true);

    if (sigErr) throw sigErr;

    const { data: settingsRows, error: setErr } = await supabase
      .from('user_settings')
      .select('user_id, telegram_enabled, telegram_bot_token, telegram_chat_id, notify_min_confidence, auto_engine_enabled, signals_paused, notify_instruments');

    if (setErr) throw setErr;

    const settingsByUser = new Map((settingsRows ?? []).map((r: any) => [r.user_id, r]));

    const FOREX = [
      'EUR/USD',
      'GBP/USD',
      'USD/JPY',
      'AUD/USD',
      'GBP/JPY',
      'XAU/USD',
    ];

    const weekendForexLeaks = (signals ?? []).filter((s: any) => {
      if (!FOREX.includes(s.instrument)) return false;

      const d = new Date(s.created_at);
      const day = d.getUTCDay();
      const hour = d.getUTCHours();

      return (
        day === 6 ||
        (day === 0 && hour < 22) ||
        (day === 5 && hour >= 22)
      );
    });

    const isSent = (s: any) => s.telegram_status === 'sent' && s.telegram_message_id != null;

    // Mirrors the engine's own rule: alert when the user has Telegram set up
    // and confidence >= their notify_min_confidence (default 70). Uses the
    // CURRENT threshold, so a threshold changed inside the window can mislabel.
    const telegramReady = (u: any) => !!(u?.telegram_enabled && u.telegram_bot_token && u.telegram_chat_id);
    // Rule-based signals (SMC CHoCH + FVG and the gems) are always alerted, whatever the threshold.
    const meetsThreshold = (s: any) =>
      s.setup_type === 'smc_choch_fvg' || String(s.setup_type ?? '').startsWith('gem_') ||
      Number(s.confidence) >= (settingsByUser.get(s.user_id)?.notify_min_confidence ?? 70);

    const shouldPush = (signals ?? []).filter((s: any) => telegramReady(settingsByUser.get(s.user_id)) && meetsThreshold(s));
    const pushed = shouldPush.filter(isSent);
    const missed = shouldPush.filter((s: any) => !isSent(s));
    const noTelegram = (signals ?? []).filter((s: any) => !telegramReady(settingsByUser.get(s.user_id)));
    // The engine only saves signals at or above the threshold, so any here point to a changed threshold or a bug.
    const belowThreshold = (signals ?? []).filter((s: any) => !meetsThreshold(s));

    const missedDetails = missed
      .slice(0, 5)
      .map(
        (s: any) =>
          `${s.instrument} ${s.trade_type} (confidence ${s.confidence}): ${s.telegram_status ?? 'no delivery record'}${s.telegram_error ? ` - ${s.telegram_error}` : ''}`
      )
      .join('; ');

    const { data: cronRows, error: cronErr } = await supabase.rpc('signal_engine_cron_health');
    const cron = cronRows?.[0];
    const cronProblems = cron
      ? cron.failed_24h + cron.http_timed_out + cron.http_failed + cron.http_missing + cron.http_with_errors
      : 0;
    const jobConcern = !!cronErr || !cron || !cron.job_active || cron.fired_24h < 23;
    // ---- Expected vs saved: replay the last hourly runs with the live rules ----
    // A strategy that silently stops firing (a short candle fetch, a broken gate)
    // still lets the job run and Telegram deliver, so only this check catches it.
    const engineUsers = (settingsRows ?? []).filter((u: any) => u.auto_engine_enabled && !u.signals_paused);
    const nowEpoch = Math.floor(Date.now() / 1000);
    const lastRun = Math.floor((nowEpoch - 120) / 3600) * 3600; // a run needs ~2 min to finish
    const runs = Array.from({ length: AMA_REPLAY_HOURS }, (_, k) => lastRun - k * 3600);
    const missedSetups: string[] = [];
    let expectedSetups = 0, slotBusy = 0;
    let replayError: string | null = null;
    try {
      const candles = await fetchLiveCandles();
      const { data: rows, error: rowsErr } = await supabase
        .from('generated_signals')
        .select('user_id, instrument, setup_type, outcome, generated_at, closed_at')
        .gte('generated_at', new Date((runs[runs.length - 1] - 14 * 86400) * 1000).toISOString());
      if (rowsErr) throw rowsErr;
      const at = (iso: string | null) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : 0);
      for (const run of runs) {
        for (const inst of LIVE_INSTRUMENTS) {
          const c = candles.get(inst)!;
          const upTo = (arr: any[]) => arr.filter(k => k.epoch <= run + 5);
          const setup = evaluateLiveSetups(inst, { d1: upTo(c.d1), h4: upTo(c.h4), h1: upTo(c.h1), m15: upTo(c.m15) }, run + 5);
          if (!setup) continue;
          for (const u of engineUsers) {
            if (u.notify_instruments?.length && !u.notify_instruments.includes(inst)) continue;
            expectedSetups++;
            const mine = (rows ?? []).filter((r: any) => r.user_id === u.user_id && r.instrument === inst);
            // Saved in this run, or in the run before (the engine skips a repeat of the same setup).
            const saved = mine.some((r: any) => r.setup_type === setup.setupType && at(r.generated_at) >= run - 3600 && at(r.generated_at) < run + 3600);
            if (saved) continue;
            // A trade already open on the pair holds its slot; the arbiter blocks a second one.
            const busy = mine.some((r: any) => at(r.generated_at) < run && (r.outcome === 'pending' || at(r.closed_at) > run));
            if (busy) { slotBusy++; continue; }
            missedSetups.push(`${inst} ${setup.setupType} ${setup.direction} at ${new Date(run * 1000).toISOString().slice(11, 16)} UTC`);
          }
        }
      }
    } catch (err) {
      replayError = err instanceof Error ? err.message : String(err);
    }

    // ---- Trades the outcome check should have closed by now ----
    const { data: openRows } = await supabase
      .from('generated_signals')
      .select('instrument, trade_type, setup_type, generated_at')
      .eq('outcome', 'pending');
    const stuck = (openRows ?? []).filter((r: any) => {
      const ageHours = (Date.now() - new Date(r.generated_at).getTime()) / 3600000;
      const fillWindow = r.trade_type === 'day' ? 4 : 24;
      return ageHours > fillWindow + maxHoldHours(r.setup_type, r.trade_type) + 2;
    });

    const problemCount = cronProblems + missed.length + weekendForexLeaks.length + missedSetups.length + stuck.length + (replayError ? 1 : 0);
    // Decided here from the counts, not by the model.
    const hasProblem = jobConcern || problemCount > 0;

    const cronFacts = cronErr || !cron
      ? [`Hourly signal-engine job: health check unavailable (${cronErr?.message ?? 'no data'})`]
      : [
          `Hourly signal-engine job is ${cron.job_active ? 'active' : 'NOT ACTIVE'}`,
          `Times the job fired in the last 24h: ${cron.fired_24h} of 24 expected, ${cron.failed_24h} failed to fire`,
          `Last fired: ${cron.last_fired ?? 'never in the last 24h'}`,
          `Engine answers for the ${cron.http_checked} most recent runs (only ~6h of answers are kept): ${cron.http_ok} completed, ${cron.http_with_errors} of those reported per-instrument errors, ${cron.http_timed_out} timed out, ${cron.http_failed} returned an error status, ${cron.http_missing} have no answer logged`,
        ];

    const facts = [
      ...cronFacts,
      `Engine-generated signals in the last ${AMA_LOOKBACK_HOURS}h: ${signals?.length ?? 0}`,
      `Signals that should have gone to Telegram (user has Telegram set up and confidence >= their threshold): ${shouldPush.length}`,
      `Of those, confirmed delivered (status sent + message_id): ${pushed.length}`,
      `Of those, NOT confirmed delivered: ${missed.length}`,
      missedDetails ? `Not delivered: ${missedDetails}` : 'Not delivered: none',
      `Signals for users without Telegram set up (no push expected): ${noTelegram.length}`,
      `Signals saved below the user's current threshold: ${belowThreshold.length}`,
      `Forex/XAU signals inside market-closed hours: ${weekendForexLeaks.length}`,
      replayError
        ? `Expected-vs-saved replay of the last ${AMA_REPLAY_HOURS} hourly runs: could not run (${replayError})`
        : `Expected-vs-saved replay of the last ${AMA_REPLAY_HOURS} hourly runs: the live rules produced ${expectedSetups} setups for engine users; ${slotBusy} skipped because a trade was already open on that pair; ${missedSetups.length} produced but never saved${missedSetups.length ? ` (${missedSetups.slice(0, 5).join('; ')})` : ''}`,
      `Open trades past their hold limit (the outcome check should have closed them): ${stuck.length}${stuck.length ? ` (${stuck.slice(0, 5).map((r: any) => `${r.instrument} ${r.trade_type} from ${String(r.generated_at).slice(0, 16)}`).join('; ')})` : ''}`,
    ].join('\n');

    // The checks above are the result; DeepSeek only words it. If the model
    // fails, the raw facts go out instead so a model outage never hides or
    // fakes a pipeline problem.
    const verdict = hasProblem ? 'PROBLEM' : 'ALL CLEAR';
    let report: string;
    try {
      report = await callDeepSeek(
        'You are Ama, QA for a trading-signal engine. Report four things: whether the hourly server job ran and the engine answered; whether every setup the live rules produced was saved as a signal; whether every signal that should alert was delivered to Telegram; and whether any open trade is past its hold limit. Under 150 words, plain text, no filler. Start with the verdict you are given, word for word. If setups were produced but never saved, or there are forex/XAU signals inside market-closed hours, make that the headline. Do not invent causes.',
        `Here is what I checked:\n${facts}\n\nVerdict: ${verdict}. Problems counted: ${problemCount}${jobConcern ? ' (plus a job health concern)' : ''}.\nWrite the report. Do not call a delivery confirmed unless it is in the "confirmed delivered" count.`,
      );
    } catch (llmErr) {
      const reason = llmErr instanceof Error ? llmErr.message : 'unknown error';
      report = `${verdict}\n\n${facts}\n\n(Plain figures: the summary could not be written — ${reason})`;
    }

    const alert = hasProblem && alertSettings ? `\n\n${await sendAmaAlert(supabase, alertSettings, report)}` : '';
    await setDone(supabase, 'ama', task, `${report}${alert}`);
  } catch (err) {
    // A check that cannot run is itself a problem worth an alert.
    const message = err instanceof Error ? err.message : 'Unknown error';
    const alert = alertSettings
      ? `\n\n${await sendAmaAlert(supabase, alertSettings, `Ama could not complete her check: ${message}`).catch(() => 'Alert: could not be sent.')}`
      : '';
    await setError(supabase, 'ama', task, `${message}${alert}`);
  }
}
async function runYaw(supabase: ReturnType<typeof createClient>) {
  const task = 'Volatility review';
  await setWorking(supabase, 'yaw', task);
  try {
    const recentSince = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const baselineSince = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const { data: recent } = await supabase
      .from('generated_signals')
      .select('instrument, atr_percentile_at_entry')
      .gte('created_at', recentSince)
      .not('atr_percentile_at_entry', 'is', null);
    const { data: baseline } = await supabase
      .from('generated_signals')
      .select('instrument, atr_percentile_at_entry')
      .gte('created_at', baselineSince)
      .lt('created_at', recentSince)
      .not('atr_percentile_at_entry', 'is', null);

    const avgBy = (rows: any[] | null) => {
      const m = new Map<string, number[]>();
      for (const r of rows ?? []) {
        if (!m.has(r.instrument)) m.set(r.instrument, []);
        m.get(r.instrument)!.push(r.atr_percentile_at_entry);
      }
      const out: Record<string, number> = {};
      for (const [k, v] of m) out[k] = v.reduce((a, b) => a + b, 0) / v.length;
      return out;
    };
    const recentAvg = avgBy(recent), baselineAvg = avgBy(baseline);
    const shifts = Object.keys(recentAvg)
      .filter(k => baselineAvg[k] !== undefined)
      .map(k => ({ inst: k, recent: recentAvg[k], baseline: baselineAvg[k], delta: recentAvg[k] - baselineAvg[k] }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const facts = shifts.length
      ? shifts.slice(0, 6).map(s => `${s.inst}: ATR percentile ${s.baseline.toFixed(0)} (30d) -> ${s.recent.toFixed(0)} (3d), delta ${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(0)}`).join('\n')
      : 'Not enough signal history yet to compare a 3-day window against a 30-day baseline.';

    const report = await callDeepSeek(
      'You are Yaw, a market research assistant for a trading app. You are given REAL computed ATR-percentile shifts per instrument (not opinions) — narrate only what the numbers actually show, do not invent patterns beyond them. Under 130 words.',
      `Volatility shifts (3-day recent vs 30-day baseline, ATR percentile):\n${facts}\n\nWrite the report, noting which instruments moved most.`,
    );
    await setDone(supabase, 'yaw', task, report);
  } catch (err) {
    await setError(supabase, 'yaw', task, err instanceof Error ? err.message : 'Unknown error');
  }
}

// --- Kobby: economic news ---
async function runKobby(supabase: ReturnType<typeof createClient>) {
  const task = 'Economic calendar check';
  await setWorking(supabase, 'kobby', task);
  try {
    const finnhubKey = Deno.env.get('FINNHUB_API_KEY');
    if (!finnhubKey) {
      await setError(supabase, 'kobby', task, 'Not running: no economic calendar API key (FINNHUB_API_KEY). Add a Finnhub key as a Supabase secret to turn this on.');
      return;
    }

    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await fetch(`https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${finnhubKey}`);
    if (!res.ok) throw new Error(`Finnhub error ${res.status}`);
    const json = await res.json();
    const events = (json.economicCalendar ?? []).filter((e: any) => e.impact === 'high');

    const facts = events.length
      ? events.slice(0, 10).map((e: any) => `${e.time} ${e.country} ${e.event} (impact: ${e.impact})`).join('\n')
      : 'No high-impact events found in the next 48 hours.';

    const report = await callDeepSeek(
      'You are Kobby, covering economic news for a forex/gold trading app. Given real upcoming high-impact calendar events, briefly note which currency pairs or XAU/USD could see elevated volatility around them. Under 130 words. Do not give trading advice, just flag timing/volatility risk.',
      `Upcoming high-impact events:\n${facts}\n\nWrite the report.`,
    );
    await setDone(supabase, 'kobby', task, report);
  } catch (err) {
    await setError(supabase, 'kobby', task, err instanceof Error ? err.message : 'Unknown error');
  }
}

// --- Boss: reads everyone's latest, synthesizes, sends the Telegram digest ---
async function runBoss(supabase: ReturnType<typeof createClient>, settings: { user_id: string; telegram_enabled?: boolean; telegram_bot_token?: string; telegram_chat_id?: string } | null) {
  const task = 'Daily digest';
  await setWorking(supabase, 'boss', task);
  try {
    const { data: activity } = await supabase
      .from('ai_employee_activity')
      .select('employee_id, status, last_report, updated_at')
      .neq('employee_id', 'boss');

    const byId = new Map((activity ?? []).map((a: any) => [a.employee_id, a]));
    const names: Record<string, string> = { kofi: 'Kofi (Security)', ama: 'Ama (Signal QA)', yaw: 'Yaw (Market Research)', kobby: 'Kobby (Economic News)' };
    const facts = Object.keys(names).map(id => {
      const a = byId.get(id);
      if (!a) return `${names[id]}: no report yet`;
      return `${names[id]} [${a.status}]: ${a.last_report ?? '(no report)'}`;
    }).join('\n\n');

    const digest = await callDeepSeek(
      'You are the Boss, summarizing four employees\' reports into one digest for the human owner of this trading app. Be concise — under 150 words total. Lead with anything that needs attention (errors, regressions, high-impact news); routine all-clear items get one short line each.',
      `Today's reports:\n\n${facts}\n\nWrite the digest.`,
    );

    // send-telegram posts as Markdown; model output with stray * _ ` [ ] makes
    // Telegram reject the whole message, so the digest body goes out plain.
    let delivery = 'Telegram: not sent (Telegram is disabled or not configured).';
    if (settings?.telegram_enabled && settings.telegram_bot_token && settings.telegram_chat_id) {
      const { data, error } = await supabase.functions.invoke('send-telegram', {
        body: {
          action: 'send',
          bot_token: settings.telegram_bot_token,
          chat_id: settings.telegram_chat_id,
          message: `🏢 *AI Team Daily Digest*\n\n${digest.replace(/[_*`\[\]]/g, '')}`,
        },
      });
      if (error || !data?.success) {
        const reason = data?.error ?? error?.message ?? 'unknown error';
        await setError(supabase, 'boss', task, `${digest}\n\nTelegram: delivery FAILED — ${reason}`);
        return;
      }
      delivery = `Telegram: delivered (message ${data.message_id ?? 'id unknown'}).`;
    }

    await setDone(supabase, 'boss', task, `${digest}\n\n${delivery}`);
  } catch (err) {
    await setError(supabase, 'boss', task, err instanceof Error ? err.message : 'Unknown error');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (!(await isAuthorized(req, supabase))) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const employee = body.employee as string | undefined;

    // Boss needs telegram settings to deliver the digest — the admin's own
    // settings (single-admin app today; revisit if multi-tenant).
    const { data: settingsRows } = await supabase.from('user_settings').select('*').eq('is_admin', true).limit(1);
    const settings = settingsRows?.[0] ?? null;

    if (employee === 'kofi') await runKofi(supabase);
    else if (employee === 'ama') await runAma(supabase, settings);
    else if (employee === 'yaw') await runYaw(supabase);
    else if (employee === 'kobby') await runKobby(supabase);
    else if (employee === 'boss') await runBoss(supabase, settings);
    else {
      // Default: run the four workers, then Boss synthesizes and sends the digest.
      await runKofi(supabase);
      await runAma(supabase);
      await runYaw(supabase);
      await runKobby(supabase);
      await runBoss(supabase, settings);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('AI employees error:', err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

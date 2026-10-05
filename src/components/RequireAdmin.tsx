import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- DeepSeek ---
// Model names deepseek-chat / deepseek-reasoner are being retired; use the
// current v4 family. Flash is the fast/cheap tier — the right fit for
// frequent background workers like these. Check https://api-docs.deepseek.com
// if this model id ever starts erroring as deprecated.
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

async function callDeepSeek(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) return '(DeepSeek API key not configured — set DEEPSEEK_API_KEY as a Supabase secret.)';

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
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '(no response)';
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

    const { data: httpRows } = await supabase.rpc('recent_telegram_http_responses', { lookback_minutes: 180 });
    const failed = (httpRows ?? []).filter((r: any) => r.status_code && r.status_code >= 400);
    const timedOut = (httpRows ?? []).filter((r: any) => r.timed_out);

    const facts = [
      `Tables with RLS disabled: ${noRls.length ? noRls.map((r: any) => r.table_name).join(', ') : 'none'}`,
      `Tables with RLS enabled but zero policies (effectively locked to everyone, including owners via PostgREST): ${noPolicies.length ? noPolicies.map((r: any) => r.table_name).join(', ') : 'none'}`,
      `HTTP calls in the last 3h with a 4xx/5xx status: ${failed.length}`,
      `HTTP calls in the last 3h that timed out: ${timedOut.length}`,
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

// --- Ama: signal generation + Telegram delivery QA ---
async function runAma(supabase: ReturnType<typeof createClient>) {
  const task = 'Signal & Telegram QA';
  await setWorking(supabase, 'ama', task);
  try {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data: signals, error: sigErr } = await supabase
      .from('generated_signals')
      .select('instrument, trade_type, engine_generated, created_at')
      .gte('created_at', since)
      .eq('engine_generated', true);
    if (sigErr) throw sigErr;

    const FOREX = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];
    const weekendForexLeaks = (signals ?? []).filter(s => {
      if (!FOREX.includes(s.instrument)) return false;
      const d = new Date(s.created_at);
      const day = d.getUTCDay(), hour = d.getUTCHours();
      return day === 6 || (day === 0 && hour < 22) || (day === 5 && hour >= 22);
    });

    const { data: httpRows } = await supabase.rpc('recent_telegram_http_responses', { lookback_minutes: 360 });
    const telegramErrors = (httpRows ?? []).filter((r: any) => r.status_code && r.status_code >= 400);

    const facts = [
      `Engine-generated signals in the last 6h: ${signals?.length ?? 0} (swing + day combined)`,
      `Forex/XAU signals that fell inside market-closed hours (should be zero after the weekend fix): ${weekendForexLeaks.length}`,
      `HTTP errors in the last 6h on calls that look like Telegram delivery: ${telegramErrors.length}`,
    ].join('\n');

    const report = await callDeepSeek(
      'You are Ama, QA for a trading-signal engine. Your job is confirming signals are actually being generated and actually reaching Telegram — not just that the cron "succeeded". Under 120 words, plain, no filler.',
      `Here is what I checked:\n${facts}\n\nWrite the report. If weekendForexLeaks > 0, that is a regression and should be flagged clearly as the headline.`,
    );
    await setDone(supabase, 'ama', task, report);
  } catch (err) {
    await setError(supabase, 'ama', task, err instanceof Error ? err.message : 'Unknown error');
  }
}

// --- Yaw: market behavior shifts, grounded in real computed stats ---
async function runYaw(supabase: ReturnType<typeof createClient>) {
  const task = 'Volatility & spike-rate review';
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
      await setDone(supabase, 'kobby', task, 'No economic calendar API key configured yet (FINNHUB_API_KEY). Sign up for a free Finnhub account and add the key as a Supabase secret to turn this on.');
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
    await setDone(supabase, 'boss', task, digest);

    if (settings?.telegram_enabled && settings.telegram_bot_token && settings.telegram_chat_id) {
      await supabase.functions.invoke('send-telegram', {
        body: {
          action: 'send',
          bot_token: settings.telegram_bot_token,
          chat_id: settings.telegram_chat_id,
          message: `🏢 *AI Team Daily Digest*\n\n${digest}`,
        },
      });
    }
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

    const body = await req.json().catch(() => ({}));
    const employee = body.employee as string | undefined;

    // Boss needs telegram settings to deliver the digest — reuse the first
    // admin user's settings (single-user app today; revisit if multi-tenant).
    const { data: settingsRows } = await supabase.from('user_settings').select('*').limit(1);
    const settings = settingsRows?.[0] ?? null;

    if (employee === 'kofi') await runKofi(supabase);
    else if (employee === 'ama') await runAma(supabase);
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
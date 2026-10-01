import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    // Trusted server-to-server calls (e.g. signal-engine's cron job) present the
    // project's own service role key. There's no end-user session in that context,
    // so we skip auth.getUser() and trust the key itself — it's never exposed
    // publicly and only ever lives in Supabase secrets / cron job SQL.
    const token = authHeader.replace('Bearer ', '');
    const isServiceRoleCall = token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!isServiceRoleCall) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
    }

    const body = await req.json();
    const { action, bot_token, chat_id, message } = body;

    if (action === 'test') {
      // Send test message
      const testMsg = '✅ *FX Swing Bot Connected!*\n\nYou will receive trading signals here.';
      const res = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text: testMsg, parse_mode: 'Markdown' }),
      });
      const data = await res.json();
      
      if (!data.ok) {
        return new Response(JSON.stringify({ success: false, error: data.description }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'send') {
      const res = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text: message, parse_mode: 'Markdown' }),
      });
      const data = await res.json();
      
      return new Response(JSON.stringify({ success: data.ok, error: data.ok ? undefined : data.description }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
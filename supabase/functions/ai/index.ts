// Edge Function: market intelligence for Listed.
//   mode "markets" -> deterministic snapshot of Bay Area zips (no model call, free to run)
//   mode "advisor" -> an agent: Claude chooses tools over the market data and this user's own
//                     homeowners and call results, then submits ranked call recommendations
//
// Auth: the browser sends the signed-in user's JWT. All database reads run with that JWT, so
// row-level security applies and a user can only ever see their own data.
//
// Scoring (market.ts), tools (market-tools.ts) and the loop (agent-loop.ts) have no Deno or
// Supabase dependencies and are unit tested. This file stays thin: auth, routing, API calls.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runAgent } from './agent-loop.ts';
import { marketAsOf, MARKET_SOURCE_NAMES } from './market.ts';
import { ADVISOR_SYSTEM, buildMarketsView, createMarketTools, loadScored, MARKET_TOOL_DEFS, type LocalData } from './market-tools.ts';

const MODEL = 'claude-opus-5-5';
const BETAS = ['server-side-fallback-2026-07-01'];
const MAX_AGENT_TURNS = 8;
const MAX_CALLS_READ = 5000;
const PAGE = 1000;
const MAX_HOMEOWNER_ROWS = 20000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

type Sb = ReturnType<typeof createClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function supabaseLocalData(sb: Sb, userId: string): LocalData {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  return {
    async homeownerTenures() {
      const rows: { zip: string; years_owned: number }[] = [];
      for (let from = 0; from < MAX_HOMEOWNER_ROWS; from += PAGE) {
        const { data, error } = await sb
          .from('homeowners')
          .select('zip,years_owned')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) fail(error.message);
        rows.push(...((data ?? []) as typeof rows));
        if ((data ?? []).length < PAGE) break;
      }
      return rows;
    },
    async calls() {
      const { data, error } = await sb.from('calls').select('homeowner_id,outcome').eq('user_id', userId).limit(MAX_CALLS_READ);
      if (error) fail(error.message);
      return (data ?? []) as { homeowner_id: string | number; outcome: string }[];
    },
    async homeowners(ids) {
      // homeowners.id is a uuid column; older call rows can hold ids like "o1", and one bad
      // value makes Postgres reject the whole lookup. Those calls simply won't match an owner.
      const valid = ids.filter((id) => typeof id === 'string' && UUID.test(id));
      const rows: { id: string | number; zip: string; years_owned: number }[] = [];
      for (let i = 0; i < valid.length; i += 100) {
        const { data, error } = await sb.from('homeowners').select('id,zip,years_owned').in('id', valid.slice(i, i + 100));
        if (error) fail(error.message);
        rows.push(...((data ?? []) as typeof rows));
      }
      return rows;
    },
  };
}

async function markets(sb: Sb, userId: string) {
  return json(buildMarketsView(await loadScored(supabaseLocalData(sb, userId))));
}

async function advisor(client: Anthropic, sb: Sb, userId: string) {
  const ctx = await loadScored(supabaseLocalData(sb, userId));
  const { tools, getSubmission } = createMarketTools(ctx);

  const result = await runAgent({
    firstMessage: `Today is ${new Date().toISOString().slice(0, 10)}. Analyze the market data and tell me which zip codes to call.`,
    maxTurns: MAX_AGENT_TURNS,
    stopAfter: 'submit_recommendations',
    tools,
    createTurn: (messages) =>
      client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: BETAS,
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: ADVISOR_SYSTEM,
        tools: [...MARKET_TOOL_DEFS],
        messages,
      }),
  });

  if (!result.ok) {
    if (result.reason === 'refusal') return json({ error: 'The AI declined this request.' }, 422);
    if (result.reason === 'max_tokens') return json({ error: 'The AI ran out of room. Try again.' }, 502);
    return json({ error: 'The analyst took too many steps. Try again.' }, 502);
  }
  const analysis = getSubmission();
  if (!analysis) return json({ error: 'The analyst did not finish. Try again.' }, 502);
  return json({ analysis, steps: result.steps, as_of: marketAsOf(), sources: MARKET_SOURCE_NAMES });
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
    error: authError,
  } = await sb.auth.getUser();
  if (authError || !user) return json({ error: 'Please sign in again.' }, 401);

  let body: { mode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  try {
    if (body.mode === 'markets') return await markets(sb, user.id);
    if (body.mode === 'advisor') {
      const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!apiKey) return json({ error: 'AI is not configured yet.' }, 500);
      return await advisor(new Anthropic({ apiKey }), sb, user.id);
    }
    return json({ error: 'Unknown mode.' }, 400);
  } catch (e) {
    console.error('ai function error', e);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy. Try again in a minute.' }, 429);
    return json({ error: 'Something went wrong. Try again.' }, 502);
  }
});

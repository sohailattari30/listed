// Edge Function: AI features for Listed.
//   mode "briefing" -> single LLM call (NOT an agent): pre-call opener + objection handling
//   mode "coach"    -> real agent: Claude chooses tools, reads the user's own data, loops until it has an answer
//
// Auth: the browser sends the signed-in user's JWT. All database reads run with that JWT, so
// row-level security applies and a user can only ever see their own data.
//
// The loop (agent-loop.ts), tools (coach-tools.ts) and analytics (analytics.ts) have no Deno or
// Supabase dependencies and are unit tested. This file stays thin: auth, routing, API calls.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk/helpers/zod';
import { z } from 'npm:zod';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runAgent } from './agent-loop.ts';
import { COACH_TOOL_DEFS, createCoachTools, MAX_CALLS_READ, type CoachData } from './coach-tools.ts';

const MODEL = 'claude-opus-5-5';
const BETAS = ['server-side-fallback-2026-07-01'];
const MAX_AGENT_TURNS = 6;

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

// ---------------------------------------------------------------------------
// Mode 1: briefing (single call, structured output)
// ---------------------------------------------------------------------------

const Briefing = z.object({
  opener: z.string(),
  angle: z.string(),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })),
});

const BRIEFING_SYSTEM = `You help a real estate agent prepare for a cold call to a homeowner.
You are given only the facts below. Do not invent anything else: no home value, no listing status, no neighborhood sales, no family details.
Write:
- opener: a natural first sentence the agent can say, under 30 words, that names the agent and sounds like a person, not a script.
- angle: one sentence on why this call is reasonable, based only on the facts (for example, how long they have owned).
- objections: exactly 3 likely objections with a short, respectful reply each (under 25 words).
Rules: no pressure tactics, no misleading claims. If the call history says the homeowner already said they were not interested, make the opener lighter and acknowledge the earlier call.`;

async function briefing(client: Anthropic, sb: Sb, userId: string, homeownerId: string | number) {
  const [{ data: owner }, { data: profile }, { data: calls }] = await Promise.all([
    sb.from('homeowners').select('id,owner_name,address,years_owned,zip').eq('id', homeownerId).single(),
    sb.from('users').select('name,city,zip').eq('id', userId).single(),
    sb.from('calls').select('outcome').eq('user_id', userId).eq('homeowner_id', homeownerId),
  ]);
  if (!owner) return json({ error: 'Homeowner not found.' }, 404);

  const agentFirst = ((profile?.name as string) || '').split(' ')[0] || 'an agent';
  const history = (calls ?? []).map((c: { outcome: string }) => c.outcome).filter((o: string) => o !== 'skip');
  const facts = [
    `Agent first name: ${agentFirst}`,
    `Agent market: ${profile?.city || profile?.zip || 'unknown'}`,
    `Homeowner name: ${owner.owner_name}`,
    `Street: ${String(owner.address).split(',')[0]}`,
    `Years owned: ${owner.years_owned}`,
    `Previous call outcomes (oldest first, sell = wants to sell, vm = voicemail, no = not interested): ${history.length ? history.join(', ') : 'none, first call'}`,
  ].join('\n');

  const resp = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: BETAS,
    fallbacks: 'default',
    output_config: { effort: 'low', format: zodOutputFormat(Briefing) },
    system: BRIEFING_SYSTEM,
    messages: [{ role: 'user', content: facts }],
  });

  if (resp.stop_reason === 'refusal') return json({ error: 'The AI declined this request.' }, 422);
  const text = resp.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
  const parsed = Briefing.safeParse(JSON.parse(text?.text ?? 'null'));
  if (!parsed.success) return json({ error: 'The AI returned an unexpected format. Try again.' }, 502);
  return json({ briefing: parsed.data });
}

// ---------------------------------------------------------------------------
// Mode 2: coach (agent loop with tools over the user's own data)
// ---------------------------------------------------------------------------

const COACH_SYSTEM = `You are the daily coach inside Listed, an app that helps real estate agents build a cold-calling habit (50 calls a day, goal: first listing).
Before you answer, use your tools to look at this user's real numbers. Never invent numbers. If there are fewer than 30 logged conversations, say the sample is still small instead of drawing strong conclusions.
Answer in this exact shape, plain text, under 90 words total:
Line 1: one punchy headline sentence.
Then 2 or 3 lines, each starting with "- ", each one concrete insight from the data.
Last line: starts with "Today: " followed by one specific thing to do in today's 50 calls.
No markdown other than the leading "- ". Be warm and direct, like a good coach.`;

function supabaseCoachData(sb: Sb, userId: string): CoachData {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  return {
    async calls() {
      const { data, error } = await sb.from('calls').select('homeowner_id,outcome').eq('user_id', userId).limit(MAX_CALLS_READ);
      if (error) fail(error.message);
      return (data ?? []) as { homeowner_id: string | number; outcome: string }[];
    },
    async sessions(limit) {
      const { data, error } = await sb
        .from('sessions')
        .select('session_date,calls_made,hot_leads')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(limit);
      if (error) fail(error.message);
      return (data ?? []) as { session_date: string; calls_made: number; hot_leads: number }[];
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

async function coach(client: Anthropic, sb: Sb, userId: string) {
  const result = await runAgent({
    firstMessage: `Today is ${new Date().toISOString().slice(0, 10)}. Review my calling data and coach me for today.`,
    maxTurns: MAX_AGENT_TURNS,
    tools: createCoachTools(supabaseCoachData(sb, userId)),
    createTurn: (messages) =>
      client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: BETAS,
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: COACH_SYSTEM,
        tools: [...COACH_TOOL_DEFS],
        messages,
      }),
  });

  if (result.ok) return json({ text: result.text, steps: result.steps });
  if (result.reason === 'refusal') return json({ error: 'The AI declined this request.' }, 422);
  if (result.reason === 'max_tokens') return json({ error: 'The AI ran out of room. Try again.' }, 502);
  return json({ error: 'The coach took too many steps. Try again.' }, 502);
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI is not configured yet.' }, 500);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
    error: authError,
  } = await sb.auth.getUser();
  if (authError || !user) return json({ error: 'Please sign in again.' }, 401);

  let body: { mode?: string; homeowner_id?: string | number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const client = new Anthropic({ apiKey });
  try {
    if (body.mode === 'briefing') {
      if (body.homeowner_id === undefined || body.homeowner_id === null) return json({ error: 'homeowner_id required.' }, 400);
      return await briefing(client, sb, user.id, body.homeowner_id);
    }
    if (body.mode === 'coach') return await coach(client, sb, user.id);
    return json({ error: 'Unknown mode.' }, 400);
  } catch (e) {
    console.error('ai function error', e);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy. Try again in a minute.' }, 429);
    return json({ error: 'The AI hit a problem. Try again.' }, 502);
  }
});

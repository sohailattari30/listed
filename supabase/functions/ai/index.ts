// Edge Function: AI features for Listed.
//   mode "briefing" -> single LLM call (NOT an agent): pre-call opener + objection handling
//   mode "coach"    -> real agent: Claude chooses tools, reads the user's own data, loops until it has an answer
//
// Auth: the browser sends the signed-in user's JWT. All database reads run with that JWT, so
// row-level security applies and a user can only ever see their own data.

import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const BETAS = ["server-side-fallback-2026-07-01"];
const MAX_AGENT_TURNS = 6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

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

async function briefing(
  client: Anthropic,
  sb: ReturnType<typeof createClient>,
  userId: string,
  homeownerId: string | number,
) {
  const [{ data: owner }, { data: profile }, { data: calls }] = await Promise.all([
    sb.from("homeowners").select("id,owner_name,address,years_owned,zip").eq("id", homeownerId).single(),
    sb.from("users").select("name,city,zip").eq("id", userId).single(),
    sb.from("calls").select("outcome").eq("user_id", userId).eq("homeowner_id", homeownerId),
  ]);
  if (!owner) return json({ error: "Homeowner not found." }, 404);

  const agentFirst = ((profile?.name as string) || "").split(" ")[0] || "an agent";
  const history = (calls ?? []).map((c: { outcome: string }) => c.outcome).filter((o: string) => o !== "skip");
  const facts = [
    `Agent first name: ${agentFirst}`,
    `Agent market: ${profile?.city || profile?.zip || "unknown"}`,
    `Homeowner name: ${owner.owner_name}`,
    `Street: ${String(owner.address).split(",")[0]}`,
    `Years owned: ${owner.years_owned}`,
    `Previous call outcomes (oldest first, sell = wants to sell, vm = voicemail, no = not interested): ${history.length ? history.join(", ") : "none, first call"}`,
  ].join("\n");

  const resp = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: BETAS,
    fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(Briefing) },
    system: BRIEFING_SYSTEM,
    messages: [{ role: "user", content: facts }],
  });

  if (resp.stop_reason === "refusal") return json({ error: "The AI declined this request." }, 422);
  const text = resp.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined;
  const parsed = Briefing.safeParse(JSON.parse(text?.text ?? "null"));
  if (!parsed.success) return json({ error: "The AI returned an unexpected format. Try again." }, 502);
  return json({ briefing: parsed.data });
}

// ---------------------------------------------------------------------------
// Mode 2: coach (agent loop with tools over the user's own data)
// ---------------------------------------------------------------------------

type ToolOut = { data: unknown; summary: string };
type Sb = ReturnType<typeof createClient>;

function makeTools(sb: Sb, userId: string) {
  const tally = (rows: { outcome: string }[]) => {
    const t = { sell: 0, vm: 0, no: 0, skip: 0 };
    for (const r of rows) if (r.outcome in t) t[r.outcome as keyof typeof t]++;
    return t;
  };

  async function getOverallStats(): Promise<ToolOut> {
    const [{ data: calls, error: e1 }, { data: sessions, error: e2 }] = await Promise.all([
      sb.from("calls").select("outcome").eq("user_id", userId).limit(5000),
      sb.from("sessions").select("calls_made,hot_leads").eq("user_id", userId),
    ]);
    if (e1 || e2) throw new Error((e1 ?? e2)!.message);
    const t = tally(calls ?? []);
    const logged = t.sell + t.vm + t.no;
    return {
      data: {
        outcomes: t,
        conversations_logged: logged,
        hot_lead_rate: logged ? t.sell / logged : null,
        sessions_completed: sessions?.length ?? 0,
        note: (calls?.length ?? 0) >= 5000 ? "Truncated at 5000 calls." : undefined,
      },
      summary: `${logged} calls logged: ${t.sell} hot, ${t.vm} voicemail, ${t.no} not interested`,
    };
  }

  async function getSessionHistory(input: { limit?: number }): Promise<ToolOut> {
    const limit = Math.min(Math.max(Number(input.limit) || 14, 1), 60);
    const { data, error } = await sb
      .from("sessions")
      .select("session_date,calls_made,hot_leads")
      .eq("user_id", userId)
      .order("session_date", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const days = new Set((data ?? []).map((s: { session_date: string }) => s.session_date));
    // Current streak: consecutive UTC days with a session, ending today (or yesterday if not yet called today).
    const cursor = new Date();
    if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
    let streak = 0;
    while (days.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return {
      data: { sessions: data ?? [], current_streak_days: streak },
      summary: `Read your last ${data?.length ?? 0} sessions (streak: ${streak} day${streak === 1 ? "" : "s"})`,
    };
  }

  async function getConversionBySegment(input: { segment?: string }): Promise<ToolOut> {
    const segment = input.segment === "zip" ? "zip" : "tenure";
    const { data: calls, error } = await sb
      .from("calls")
      .select("homeowner_id,outcome")
      .eq("user_id", userId)
      .neq("outcome", "skip")
      .limit(5000);
    if (error) throw new Error(error.message);
    const rows = calls ?? [];
    const ids = [...new Set(rows.map((c: { homeowner_id: string }) => c.homeowner_id))];
    const owners = new Map<string, { zip: string; years_owned: number }>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error: e } = await sb.from("homeowners").select("id,zip,years_owned").in("id", ids.slice(i, i + 100));
      if (e) throw new Error(e.message);
      for (const o of data ?? []) owners.set(o.id, o);
    }
    const bucket = (y: number) => (y < 5 ? "0-4 years" : y < 10 ? "5-9 years" : y < 20 ? "10-19 years" : "20+ years");
    const groups = new Map<string, { calls: number; hot: number }>();
    for (const c of rows as { homeowner_id: string; outcome: string }[]) {
      const o = owners.get(c.homeowner_id);
      if (!o) continue;
      const key = segment === "zip" ? String(o.zip) : bucket(Number(o.years_owned));
      const g = groups.get(key) ?? { calls: 0, hot: 0 };
      g.calls++;
      if (c.outcome === "sell") g.hot++;
      groups.set(key, g);
    }
    const out = [...groups.entries()]
      .map(([name, g]) => ({ segment: name, calls: g.calls, hot: g.hot, hot_lead_rate: g.calls ? g.hot / g.calls : null }))
      .sort((a, b) => b.calls - a.calls);
    return {
      data: { grouped_by: segment === "zip" ? "zip code" : "years owned", segments: out },
      summary: `Compared ${out.length} ${segment === "zip" ? "zip codes" : "ownership-length groups"} across ${rows.length} calls`,
    };
  }

  return { getOverallStats, getSessionHistory, getConversionBySegment };
}

const COACH_TOOLS = [
  {
    name: "get_overall_stats",
    description: "Lifetime totals for this user: counts of each call outcome (sell = wants to sell, vm = voicemail, no = not interested, skip), hot lead rate, and number of completed sessions.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_session_history",
    description: "Recent daily calling sessions (date, calls made, hot leads) newest first, plus the user's current streak in days.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many recent sessions to return, 1-60. Default 14." } },
      required: [],
    },
  },
  {
    name: "get_conversion_by_segment",
    description: "Hot lead rate broken down by how long the homeowner has owned the home (tenure) or by zip code. Use it to see which kind of homeowner converts best for this user.",
    input_schema: {
      type: "object",
      properties: { segment: { type: "string", enum: ["tenure", "zip"] } },
      required: ["segment"],
    },
  },
];

const COACH_SYSTEM = `You are the daily coach inside Listed, an app that helps real estate agents build a cold-calling habit (50 calls a day, goal: first listing).
Before you answer, use your tools to look at this user's real numbers. Never invent numbers. If there are fewer than 30 logged conversations, say the sample is still small instead of drawing strong conclusions.
Answer in this exact shape, plain text, under 90 words total:
Line 1: one punchy headline sentence.
Then 2 or 3 lines, each starting with "- ", each one concrete insight from the data.
Last line: starts with "Today: " followed by one specific thing to do in today's 50 calls.
No markdown other than the leading "- ". Be warm and direct, like a good coach.`;

async function coach(client: Anthropic, sb: Sb, userId: string) {
  const tools = makeTools(sb, userId);
  const run: Record<string, (i: any) => Promise<ToolOut>> = {
    get_overall_stats: () => tools.getOverallStats(),
    get_session_history: (i) => tools.getSessionHistory(i),
    get_conversion_by_segment: (i) => tools.getConversionBySegment(i),
  };

  const messages: any[] = [
    { role: "user", content: `Today is ${new Date().toISOString().slice(0, 10)}. Review my calling data and coach me for today.` },
  ];
  const steps: { tool: string; summary: string }[] = [];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const resp = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: COACH_SYSTEM,
      tools: COACH_TOOLS,
      messages,
    });

    if (resp.stop_reason === "refusal") return json({ error: "The AI declined this request." }, 422);
    if (resp.stop_reason === "max_tokens") return json({ error: "The AI ran out of room. Try again." }, 502);

    const toolUses = resp.content.filter((b: { type: string }) => b.type === "tool_use") as {
      id: string;
      name: string;
      input: unknown;
    }[];

    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = (resp.content.filter((b: { type: string }) => b.type === "text") as { text: string }[])
        .map((b) => b.text)
        .join("\n")
        .trim();
      return json({ text, steps });
    }

    // Keep the whole assistant turn (including thinking blocks) and return every tool result in one user message.
    messages.push({ role: "assistant", content: resp.content });
    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const fn = run[tu.name];
        if (!fn) return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` };
        try {
          const out = await fn(tu.input ?? {});
          steps.push({ tool: tu.name, summary: out.summary });
          return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out.data) };
        } catch (e) {
          console.error("tool failed", tu.name, e);
          return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Tool failed to read data." };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  return json({ error: "The coach took too many steps. Try again." }, 502);
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI is not configured yet." }, 500);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ error: "Please sign in again." }, 401);

  let body: { mode?: string; homeowner_id?: string | number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const client = new Anthropic({ apiKey });
  try {
    if (body.mode === "briefing") {
      if (body.homeowner_id === undefined || body.homeowner_id === null) return json({ error: "homeowner_id required." }, 400);
      return await briefing(client, sb, user.id, body.homeowner_id);
    }
    if (body.mode === "coach") return await coach(client, sb, user.id);
    return json({ error: "Unknown mode." }, 400);
  } catch (e) {
    console.error("ai function error", e);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "The AI is busy. Try again in a minute." }, 429);
    return json({ error: "The AI hit a problem. Try again." }, 502);
  }
});

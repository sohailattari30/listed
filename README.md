# Listed.

A daily cold-calling habit app for real estate agents: 50 long-term homeowners every morning, one tap to log each call, a forecast to your first listing, and an AI coach that reads your own numbers.

**Stack:** React 19 + TypeScript (Vite) · Supabase (Auth, Postgres with row-level security, Edge Functions) · Claude API · Vitest · Netlify

## Architecture

```
src/
  auth/         AuthProvider + route guards (RequireAuth, RequireProfile)
  lib/          Pure, unit-tested logic: call queue, forecast, milestones, territory, dial helpers
                + typed Supabase data layer (api.ts, database.types.ts) + typed AI client (ai.ts)
  pages/        Login, Onboarding, Today (forecast + coach), Dial (call flow + briefing), Contacts, Progress
supabase/functions/ai/
  index.ts        Edge Function: auth, routing, Anthropic calls (thin)
  agent-loop.ts   Model-agnostic tool-use loop (tested with a scripted fake model)
  coach-tools.ts  The coach agent's tools, over an injected data interface
  analytics.ts    Streaks, outcome tallies, conversion by segment
```

### The AI features

| Feature | Kind | How it works |
| --- | --- | --- |
| **Call briefing** (Dial screen) | Single LLM call | Homeowner facts in, structured opener / angle / objection replies out (schema-validated on both ends). Fetched on tap, cached per homeowner. |
| **Daily coach** (Today screen) | Agent | Claude chooses among tools (`get_overall_stats`, `get_session_history`, `get_conversion_by_segment`), reads the signed-in user's data, loops until it can answer, and the UI shows which steps it took. |

The Anthropic key never reaches the browser. The browser sends the user's JWT to an Edge Function, which reads data **with that JWT**, so row-level security scopes every tool to the caller's own rows.

### Design decisions worth knowing

- **The agent loop is separated from the model.** `runAgent` takes an injected `createTurn`, so its rules (parallel tool results in one message, thinking blocks kept verbatim, tool errors hidden from the model, turn limits, refusal handling) are tested without the network.
- **Forecast uses a Beta-binomial posterior** (industry rate as a prior worth 100 calls), so a short cold streak can't swing the forecast to a year out.
- **Today's 50 homeowners are a seeded shuffle** keyed by day and territory: stable all day, different tomorrow, restored after a refresh.
- **Routes are code-split**: signed-out visitors never download the dialer, coach, or AI client.
- **Modals render in a portal** (pages animate with a transform, which would otherwise trap `position: fixed`).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest (unit + component tests)
npm run typecheck
npm run build
```

Supabase defaults to the production project; override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (see `.env.example`). The anon key is public by design; RLS is the security boundary.

## Deploy

- **Site:** Netlify builds from `main` (`netlify.toml`: `npm run build`, publish `dist`, SPA fallback, old `*.html` URLs redirect). `/auth-callback.html` is kept as a client route because it is already the allow-listed OAuth redirect URL.
- **AI function:**
  ```bash
  supabase link --project-ref <ref>
  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
  supabase functions deploy ai
  ```
  Without it, the briefing and coach buttons show an error message and nothing else is affected.
- **OAuth (Google/Apple):** enable the providers in the Supabase dashboard.

## Testing notes

Logic, tools, the agent loop, the AI client, and the main user flows (login, dial session, coach card) are covered. The Edge Function's `index.ts` (Anthropic and Supabase wiring) is deliberately thin and is not exercised against the live API by the test suite.

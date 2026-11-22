# Listed.

A daily cold-calling habit app for real estate agents: 50 long-term homeowners every morning, one tap to log each call, a forecast to your first listing, and an AI market analyst that tells you which zip codes to call.

**Stack:** React 19 + TypeScript (Vite) · Supabase (Auth, Postgres with row-level security, Edge Functions) · Claude API · Vitest · Netlify

## Architecture

```
src/
  auth/         AuthProvider + route guards (RequireAuth, RequireProfile)
  lib/          Pure, unit-tested logic: call queue, forecast, milestones, territory, dial helpers
                + typed Supabase data layer (api.ts) + typed, schema-validated market client (markets.ts)
  pages/        Login, Onboarding, Today, Dial (call flow), Markets, Contacts, Progress
supabase/functions/ai/
  index.ts          Edge Function: auth, routing, Anthropic calls (thin)
  agent-loop.ts     Model-agnostic tool-use loop (tested with a scripted fake model)
  market.ts         Metrics, trend labels, listing-likelihood score, rankings (pure)
  market-tools.ts   The analyst's tools, answer validator, and system prompt
  analytics.ts      Local-data helpers: tenure mix, per-zip call results, percentiles
  market-data.ts    GENERATED snapshot of 227 Bay Area zips (see below)
scripts/
  build-market-data.mjs   Streams two public datasets and writes the snapshot
```

### The market analyst

The Markets screen answers three questions: **which zips are selling the most homes, which areas are going down, and which zips to call.**

| Part | Kind | How it works |
| --- | --- | --- |
| **Market lists** (your markets, hottest zips, falling values) | Deterministic, no model | The Edge Function scores every zip from the snapshot and joins it with the homeowners your app can dial. Free to run. |
| **AI market analyst** | Agent | Claude chooses among tools (`get_market_overview`, `rank_zips`, `get_zip_details`), reads the numbers, and finishes by calling `submit_recommendations`. The answer is **validated against the data** (every zip must exist; only zips you have homeowners for can be "call now") and rejected back to the model with the exact problems if not. |

**Data** (refreshed with `npm run data:refresh`, which streams about 1 GB and keeps ~230 KB):
- Realtor.com Economic Research, monthly zip-level metrics: new and pending listings, active listings, days on market, price cuts.
- Zillow Research, home value index (ZHVI) by zip.

"Selling" is measured by **pending sales** (homes under contract), a stand-in for closed sales, which are not freely available by zip. "Going down" is the Zillow value change over 12 months. The **listing-likelihood score** is a transparent heuristic, not a trained model: sell-through, sales momentum, days on market, and the share of your homeowners who have owned 10+ years, with weights renormalised over whatever data a zip has.

The Anthropic key never reaches the browser. The browser sends the user's JWT to the Edge Function, which reads data with that JWT, so row-level security scopes every query to the caller's own rows.

### Design decisions worth knowing

- **The agent loop is separated from the model.** `runAgent` takes an injected `createTurn`, so its rules (parallel tool results in one message, thinking blocks kept verbatim, tool errors hidden from the model, validation errors shown to it so it can retry, a stop-after-submit tool, turn limits, refusal handling) are tested without the network.
- **The model explains numbers, it never computes them.** Rankings, trends and scores are plain code with tests; the agent chooses what to look at and writes the reasoning.
- **Its answer is checked, not trusted.** A recommendation for a zip that does not exist, or a "call now" for a zip with no homeowner data, is rejected before the user sees it.
- **The forecast uses a Beta-binomial posterior** (industry rate as a prior worth 100 calls), so a short cold streak can't swing the forecast to a year out.
- **Today's 50 homeowners are a seeded shuffle** keyed by day and territory: stable all day, different tomorrow, restored after a refresh.
- **Routes are code-split**: signed-out visitors never download the dialer or the market analyst.
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
  Without it, the Markets lists still work; only the "Analyze markets" button shows an error.
- **OAuth (Google/Apple):** enable the providers in the Supabase dashboard.

## Testing notes

Logic, scoring, the dataset snapshot, tools, the answer validator, the agent loop, the market client, and the main user flows (login, dial session, Markets screen) are covered. The Edge Function's `index.ts` (Anthropic and Supabase wiring) is deliberately thin and is not exercised against the live API by the test suite.

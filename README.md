# Listed.

A daily cold-calling habit app for real estate agents: 50 long-term homeowners every morning, one tap to log each call, a forecast to your first listing, and an AI market analyst that tells you which zip codes to call.

**Stack:** React 19 + TypeScript (Vite) · Supabase (Auth, Postgres with row-level security, Edge Functions) · Claude API · Vitest · Netlify

## What it does

| Screen | |
| --- | --- |
| **Sign in / Create account** | Email and password, Google and Apple sign-in, forgot password. Split-screen on desktop, single column on a phone. |
| **Onboarding** | Pick a market (zip code or city). |
| **Today** | Your day at a glance and a first-listing forecast that blends your results with the industry rate. |
| **Calls** | Today's 50 homeowners, one at a time. Log wants to sell / voicemail / not interested / skip. Progress survives a refresh. |
| **Markets** | Which zips are selling fastest, which are falling, and which to call, from public housing data plus an AI analyst. |
| **Contacts** | People you have met or want to follow up with. |
| **Progress** | Milestones from first calls to first listing. |

## How it is deployed (read this first)

The app lives in two places, and they update differently:

```
                    ┌─ automatic ──►  Netlify   (the website)
 git push ──► GitHub
                    └─ NOT connected ► Supabase (database + the "ai" function)
                                       deploy it yourself:  npx supabase functions deploy ai
```

- **The website** rebuilds on Netlify every time `main` changes.
- **The `ai` function** runs on Supabase and only changes when you upload it. Pushing to GitHub does not update it. The Markets screen needs it for **everything** (the lists as well as the analyst), so a push that changes the function is not finished until you deploy it.

Why a function at all? The Anthropic key and the check that each user only sees their own data must live on a server, not in the browser.

### First-time setup

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      # stored on Supabase, never in the repo
npx supabase functions deploy ai
```

### Every time the function changes

```bash
npx supabase functions deploy ai
```

Answer **Yes** at the prompt. The "Docker is not running" warning is harmless. Anything under `supabase/functions/ai/` (including the market data file) counts as a function change.

### Other settings

- **Netlify:** `netlify.toml` sets the build (`npm run build`, publish `dist`), Node 22, a single-page-app fallback, and redirects from the old `*.html` URLs. `/auth-callback.html` is kept as a client route on purpose: it is already the allow-listed OAuth redirect URL.
- **Supabase URL and anon key** default to the production project; override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (see `.env.example`). The anon key is public by design; row-level security is the security boundary.
- **Google/Apple sign-in:** enable the providers in the Supabase dashboard.

## The market analyst

The Markets screen answers three questions: **which zips are selling the most homes, which areas are going down, and which zips to call.**

| Part | Kind | How it works |
| --- | --- | --- |
| **Market lists** (your markets, hottest zips, falling values) | Deterministic, no model | The function scores every zip from the data snapshot and joins it with the homeowners the app can dial. Free to run. |
| **AI market analyst** | Agent | Claude chooses among tools (`get_market_overview`, `rank_zips`, `get_zip_details`), reads the numbers, and finishes by calling `submit_recommendations`. Up to 8 steps. The answer is cached in the browser for the day. |

```
Browser ──JWT──► Edge Function ──► Claude (tool use)
                      │  reads data AS the signed-in user (row-level security)
                      ▼
               Postgres: homeowners, calls
```

### What the numbers mean

- **"Selling"** is measured by **pending sales** (homes under contract), summed over the last 3 months and compared with the same 3 months a year earlier. It stands in for closed sales, which are not freely available by zip. **Sell-through** is pending sales divided by active listings.
- **"Going down"** is the change in Zillow's home value index over 12 months. Falling = down more than 1% over the year. Cooling = not down more than 1% over the year, but dropping more than 0.5% over the last 3 months. Rising = up more than 1% and not dropping recently. The numbers always appear next to the label because those thresholds are judgment calls.
- **Listing-likelihood score** (0 to 100) is a transparent heuristic, **not a trained model**. Each zip is ranked against all 227 on sell-through (weight 0.35), sales momentum (0.25) and days on market (0.10), plus the share of *your* homeowners who have owned 10+ years (0.30). Weights are renormalised over whatever data a zip has, so zips you have no homeowners for are scored on market signals alone.
- **Small sample** means Realtor.com flags the zip's listing data as unreliable, or there were very few sales. Treat its numbers cautiously.

### Design decisions worth knowing

- **The model explains numbers; it never computes them.** Rankings, trends and scores are plain, tested code. The agent chooses what to look at and writes the reasoning.
- **Its answer is checked, not trusted.** Every zip must exist in the data, and only zips you have homeowners for can be "call now". A bad answer goes back to the model with the exact problems so it can fix them.
- **The agent loop is separated from the model.** `runAgent` takes an injected `createTurn`, so its rules (parallel tool results in one message, thinking blocks kept verbatim, tool exceptions hidden from the model, validation errors shown to it so it can retry, a stop-after-submit tool, turn limit, refusal handling) are tested with a scripted fake model and no network.
- **The forecast uses a Beta-binomial posterior** (the industry rate counts as 100 imaginary calls), so a short cold streak cannot swing it to a year out.
- **Today's 50 homeowners are a seeded shuffle** keyed by day and territory: stable all day, different tomorrow, restored after a refresh.
- **Routes are code-split:** signed-out visitors never download the dialer or the analyst.
- **Modals render in a portal** (pages animate with a transform, which would otherwise trap `position: fixed`).

## The market data

`supabase/functions/ai/market-data.ts` is a **generated snapshot** of 227 Bay Area zips (San Francisco and San Jose metros), 15 months of history, about 230 KB.

| Source | Used for |
| --- | --- |
| Realtor.com Economic Research, monthly zip-level metrics | New, active and pending listings, days on market, price cuts |
| Zillow Research, home value index (ZHVI) | Home value level and change |

The data is a point in time. The Markets screen shows "as of Oct 2026" so anyone can see how old it is. A page that downloaded about 1 GB per request would be slow and costly, so a saved copy is the trade.

### Refreshing it (about monthly)

```bash
npm run data:refresh        # streams ~1 GB, keeps ~230 KB, rewrites market-data.ts
npm test                    # the snapshot guard test checks it is well-formed
git add -A && git commit    # then push
npx supabase functions deploy ai
```

Both publishers release monthly. Check each source's terms and attribution requirements before commercial use.

## Develop

```bash
npm install
npm run dev            # http://localhost:5173 (talks to the real Supabase project)
npm test               # Vitest: unit + component tests
npm run typecheck
npm run build
npm run data:refresh   # see above
```

```
src/
  auth/         AuthProvider + route guards (RequireAuth, RequireProfile)
  lib/          Pure, unit-tested logic: call queue, forecast, milestones, territory, dial helpers
                + typed Supabase data layer (api.ts) + typed, schema-validated market client (markets.ts)
  pages/        Login, Onboarding, Today, Dial, Markets, Contacts, Progress
supabase/functions/ai/
  index.ts          Edge Function: auth, routing, Anthropic calls (kept thin)
  agent-loop.ts     Model-agnostic tool-use loop
  market.ts         Metrics, trend labels, listing-likelihood score, rankings (pure)
  market-tools.ts   The analyst's tools, answer validator, system prompt
  analytics.ts      Tenure mix, per-zip call results, percentiles (pure)
  market-data.ts    GENERATED snapshot (do not edit by hand)
scripts/
  build-market-data.mjs   Streams the two public datasets and writes the snapshot
```

The only code the test suite cannot exercise is `index.ts`'s wiring to the live Anthropic and Supabase APIs. Everything else (scoring, the snapshot's shape, tools, the validator, the loop, the market client, login, the dial session and the Markets screen) is covered.

## Troubleshooting

| You see | Likely cause | Fix |
| --- | --- | --- |
| Markets shows "Unknown mode." | The function on Supabase is an older version | `npx supabase functions deploy ai` |
| "AI is not configured yet." | The Anthropic key secret is missing | `npx supabase secrets set ANTHROPIC_API_KEY=...` then redeploy |
| "Please sign in again." | Your login expired | Sign out and back in |
| "The AI is busy" / "Something went wrong" | Anthropic rate limit, billing, or a key problem | Check the function logs below |
| Analyst takes a long time | It runs several tool calls | Normal: up to about 30 seconds |

**Function logs:** Supabase dashboard, then Edge Functions, then `ai`, then Logs. Failed tool calls appear as `tool failed <name> ...` with the reason.

## Gotchas

- **No `Co-Authored-By` lines in commits.** On Netlify's free plan, a private repo allows one recognised contributor, and an unrecognised co-author makes the build fail with "unrecognized Git contributor".
- **Older test calls with fake ids** (like `o1`) may exist in the `calls` table. They are skipped when matching calls to homeowners, because the homeowners table uses UUIDs. They can distort the overall hot-lead rate; consider deleting them.
- **CI:** a GitHub Actions workflow (typecheck, test, build) can be added at `.github/workflows/ci.yml`, but GitHub rejects pushes that touch workflow files unless the token has the `workflow` scope.

## Known limits

- The analyst has no per-user rate limit. The browser caches today's result, but nothing stops repeated runs, and each one costs a model call.
- Coverage is the Bay Area only, and "call now" is only possible for zips you have homeowner data for.
- The analyst sends Anthropic zip-level numbers only: market metrics, how many homeowners you have per zip and how long they have owned, and your call results per zip. No homeowner names or addresses are sent.
- The listing score is not validated against real listings. Treat it as a way to rank, not to predict.

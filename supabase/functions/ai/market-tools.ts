// The market analyst agent: its tools, the validator for its final answer, and its system prompt.
// Tools read a scored, in-memory table, so tests can inject fixtures and the Edge Function injects
// row-level-security-scoped data for the signed-in user.

import type { ToolFn, ToolOut } from './agent-loop.ts';
import { buildLocalIndex, median, personalByZip, type Id } from './analytics.ts';
import {
  loadMetrics,
  marketAsOf,
  MARKET_SOURCE_NAMES,
  rankZips,
  RANK_METRICS,
  scoreAll,
  type RankMetric,
  type ScoredZip,
  type ZipMetrics,
} from './market.ts';

export interface LocalData {
  /** Every homeowner the app can dial: just the zip and how long they have owned. */
  homeownerTenures(): Promise<{ zip: string; years_owned: number }[]>;
  calls(): Promise<{ homeowner_id: Id; outcome: string }[]>;
  homeowners(ids: Id[]): Promise<{ id: Id; zip: string; years_owned: number }[]>;
}

export interface MarketContext {
  rows: ScoredZip[];
  /** Zips the app has homeowners for that the market dataset does not cover. */
  uncoveredZips: string[];
  /** The user's calls whose homeowner no longer exists (older test data). */
  unmatchedCalls: number;
}

export async function loadScored(local: LocalData, metrics: ZipMetrics[] = loadMetrics()): Promise<MarketContext> {
  const [tenures, calls] = await Promise.all([local.homeownerTenures(), local.calls()]);
  const ids = [...new Set(calls.filter((c) => c.outcome !== 'skip').map((c) => c.homeowner_id))];
  const found = ids.length ? await local.homeowners(ids) : [];
  const owners = new Map(found.map((o) => [o.id, { zip: o.zip }]));

  const localIndex = buildLocalIndex(tenures);
  const { byZip, unmatched } = personalByZip(calls, owners);
  const covered = new Set(metrics.map((m) => m.zip));
  return {
    rows: scoreAll(metrics, localIndex, byZip),
    uncoveredZips: [...localIndex.keys()].filter((z) => !covered.has(z)).sort(),
    unmatchedCalls: unmatched,
  };
}

// ---------------------------------------------------------------------------
// What the model (and the UI) sees for a zip
// ---------------------------------------------------------------------------

const pct = (x: number | null): number | null => (x === null ? null : Math.round(x * 1000) / 10);
const round = (x: number | null): number | null => (x === null ? null : Math.round(x));

export function zipView(z: ScoredZip) {
  return {
    zip: z.zip,
    city: z.city,
    county: z.county,
    callable: z.callable,
    listing_likelihood_score: round(z.score),
    median_list_price: round(z.medianListPrice),
    active_listings: z.activeListings,
    pending_sales_last_3_months: z.pending3m,
    pending_sales_yoy_pct: pct(z.pendingYoY),
    new_listings_yoy_pct: pct(z.newListingsYoY),
    sell_through_pct: pct(z.pendingRatio3m),
    days_on_market: round(z.daysOnMarket3m),
    price_reduced_pct: pct(z.priceReducedShare3m),
    home_value: round(z.valueNow),
    home_value_yoy_pct: pct(z.valueYoY),
    home_value_3mo_pct: pct(z.value3m),
    value_trend: z.trend,
    small_sample: z.lowSample,
    homeowners_in_app: z.local ? z.local.homeowners : null,
    owners_10plus_years_pct: z.local ? pct(z.local.longTenureShare) : null,
    my_conversations: z.personal ? z.personal.conversations : null,
    my_hot_lead_pct: z.personal ? pct(z.personal.hotRate) : null,
  };
}
export type ZipView = ReturnType<typeof zipView>;

/** Deterministic snapshot for the Markets screen. No model involved. */
export function buildMarketsView(ctx: MarketContext) {
  const list = (metric: RankMetric, opts: { limit: number; callableOnly?: boolean; excludeSmallSamples?: boolean }) =>
    rankZips(ctx.rows, metric, opts).map(zipView);
  return {
    as_of: marketAsOf(),
    sources: MARKET_SOURCE_NAMES,
    your_markets: list('listing_likelihood', { limit: 15, callableOnly: true }),
    hottest: list('sell_through', { limit: 8, excludeSmallSamples: true }),
    falling: list('value_decline', { limit: 8 }).filter((z) => (z.home_value_yoy_pct ?? 0) < 0),
    unmatched_calls: ctx.unmatchedCalls,
  };
}

// ---------------------------------------------------------------------------
// Final answer: shape and validation
// ---------------------------------------------------------------------------

export const RECOMMENDATION_ACTIONS = ['call_now', 'call_soon', 'watch', 'skip'] as const;
export type RecommendationAction = (typeof RECOMMENDATION_ACTIONS)[number];

export interface WhyItem {
  zip: string;
  city: string;
  why: string;
}
export interface Recommendation {
  zip: string;
  city: string;
  action: RecommendationAction;
  reason: string;
}
export interface MarketAnalysis {
  summary: string;
  selling_most: WhyItem[];
  going_down: WhyItem[];
  recommendations: Recommendation[];
  expansion_ideas: WhyItem[];
  caveats: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

export type Validation = { ok: true; value: MarketAnalysis } | { ok: false; error: string };

/**
 * The model's answer is checked against the data: every zip must exist, and only zips the app has
 * homeowners for may be recommended as "call". Errors go back to the model so it can fix them.
 */
export function validateAnalysis(input: unknown, rows: readonly ScoredZip[]): Validation {
  if (!isRecord(input)) return { ok: false, error: 'Expected an object with summary, selling_most, going_down, recommendations, expansion_ideas, caveats.' };
  const byZip = new Map(rows.map((r) => [r.zip, r]));
  const errors: string[] = [];

  const summary = text(input.summary, 700);
  if (!summary) errors.push('summary must be 1-700 characters.');

  const whyList = (key: 'selling_most' | 'going_down' | 'expansion_ideas', max: number, requireCallable: boolean | null): WhyItem[] => {
    const raw = input[key];
    if (!Array.isArray(raw) || raw.length > max) {
      errors.push(`${key} must be an array of at most ${max} items.`);
      return [];
    }
    const out: WhyItem[] = [];
    raw.forEach((item, i) => {
      const zip = isRecord(item) ? String(item.zip ?? '') : '';
      const why = isRecord(item) ? text(item.why, 400) : null;
      const row = byZip.get(zip);
      if (!row) errors.push(`${key}[${i}]: zip "${zip}" is not in the market data.`);
      else if (!why) errors.push(`${key}[${i}]: why must be 1-400 characters.`);
      else if (requireCallable === false && row.callable) errors.push(`${key}[${i}]: ${zip} is already callable, so list it in recommendations instead.`);
      else out.push({ zip, city: row.city, why });
    });
    return out;
  };

  const selling = whyList('selling_most', 5, null);
  const down = whyList('going_down', 5, null);
  const expansion = whyList('expansion_ideas', 3, false);

  const recs: Recommendation[] = [];
  const rawRecs = input.recommendations;
  if (!Array.isArray(rawRecs) || rawRecs.length > 6) errors.push('recommendations must be an array of at most 6 items.');
  else {
    const seen = new Set<string>();
    rawRecs.forEach((item, i) => {
      const zip = isRecord(item) ? String(item.zip ?? '') : '';
      const action = isRecord(item) ? item.action : undefined;
      const reason = isRecord(item) ? text(item.reason, 400) : null;
      const row = byZip.get(zip);
      if (!row) errors.push(`recommendations[${i}]: zip "${zip}" is not in the market data.`);
      else if (!RECOMMENDATION_ACTIONS.includes(action as RecommendationAction)) errors.push(`recommendations[${i}]: action must be one of ${RECOMMENDATION_ACTIONS.join(', ')}.`);
      else if (!reason) errors.push(`recommendations[${i}]: reason must be 1-400 characters.`);
      else if (seen.has(zip)) errors.push(`recommendations[${i}]: ${zip} appears twice.`);
      else if ((action === 'call_now' || action === 'call_soon') && !row.callable) {
        errors.push(`recommendations[${i}]: ${zip} has no homeowner data in the app, so it cannot be called yet. Put it in expansion_ideas.`);
      } else {
        seen.add(zip);
        recs.push({ zip, city: row.city, action: action as RecommendationAction, reason });
      }
    });
  }

  const rawCaveats = input.caveats;
  const caveats: string[] = [];
  if (!Array.isArray(rawCaveats) || rawCaveats.length > 4) errors.push('caveats must be an array of at most 4 strings.');
  else
    rawCaveats.forEach((c, i) => {
      const t = text(c, 300);
      if (t) caveats.push(t);
      else errors.push(`caveats[${i}] must be 1-300 characters.`);
    });

  if (errors.length > 0 || !summary) return { ok: false, error: errors.slice(0, 6).join(' ') };
  return { ok: true, value: { summary, selling_most: selling, going_down: down, recommendations: recs, expansion_ideas: expansion, caveats } };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const whyItems = (description: string) => ({
  type: 'array',
  description,
  items: { type: 'object', properties: { zip: { type: 'string' }, why: { type: 'string' } }, required: ['zip', 'why'] },
});

export const MARKET_TOOL_DEFS = [
  {
    name: 'get_market_overview',
    description:
      'Start here. Data dates and sources, how many Bay Area zips are covered, which zips the agent can actually call (the app has homeowners for them), how many zips are rising or falling, and notes on how the metrics are defined.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'rank_zips',
    description:
      'Rank zips by one metric. listing_likelihood: a transparent heuristic score (sell-through, sales momentum, days on market, share of owners 10+ years). sales_volume: most homes under contract in the last 3 months. sell_through: pending sales relative to active listings. sales_momentum: biggest rise in pending sales year over year. value_growth / value_decline: Zillow home value change over 12 months.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: [...RANK_METRICS] },
        limit: { type: 'integer', description: 'How many zips to return, 1-15. Default 8.' },
        callable_only: { type: 'boolean', description: 'Only zips the agent can call right now. Default false.' },
        exclude_small_samples: { type: 'boolean', description: 'Skip zips flagged as small samples. Default false.' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'get_zip_details',
    description: 'Full metrics for specific zips, including this agent\'s own homeowner mix and past call results in each zip.',
    input_schema: {
      type: 'object',
      properties: { zips: { type: 'array', items: { type: 'string' }, description: '1-8 five-digit zip codes.' } },
      required: ['zips'],
    },
  },
  {
    name: 'submit_recommendations',
    description:
      'Submit your final answer. Call this exactly once, when you are done. If it returns an error, fix the problems it lists and submit again.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '2-3 sentences: the market picture and the headline recommendation.' },
        selling_most: whyItems('Up to 5 zips where the most homes are selling, each with a one-sentence reason that cites numbers.'),
        going_down: whyItems('Up to 5 zips where values or activity are falling, each with a one-sentence reason that cites numbers.'),
        recommendations: {
          type: 'array',
          description: 'Up to 6 zips ordered by priority. call_now / call_soon only for zips the agent can call.',
          items: {
            type: 'object',
            properties: {
              zip: { type: 'string' },
              action: { type: 'string', enum: [...RECOMMENDATION_ACTIONS] },
              reason: { type: 'string' },
            },
            required: ['zip', 'action', 'reason'],
          },
        },
        expansion_ideas: whyItems('Up to 3 hot zips the agent cannot call yet, worth adding homeowner data for.'),
        caveats: { type: 'array', items: { type: 'string' }, description: 'Up to 4 honest limits on this analysis.' },
      },
      required: ['summary', 'selling_most', 'going_down', 'recommendations', 'expansion_ideas', 'caveats'],
    },
  },
] as const;

export const ADVISOR_SYSTEM = `You are the market analyst inside Listed, an app for real estate agents who cold-call long-term homeowners.
Answer three questions for this agent: (1) which zip codes are selling the most homes, (2) which areas are going down, (3) which zip codes they should call, based on how many homes are selling and how likely owners are to list.

How to work:
- Start with get_market_overview, then rank zips from several angles (sales_volume, sales_momentum, value_decline, and listing_likelihood with callable_only), then read get_zip_details for the zips you are about to recommend.
- Use only numbers that tools returned. Cite figures in every reason. Never invent data.
- "Selling" is measured by pending sales (homes under contract), a stand-in for closed sales. "Going down" uses Zillow's home value change and, separately, falling sales activity. Say which you mean.
- listing_likelihood_score is a transparent heuristic, not a trained prediction: it blends sell-through, sales momentum, days on market and the share of this agent's homeowners who have owned 10+ years. Describe it that way.
- call_now / call_soon are only for zips the agent can call (callable = true). Hot zips they cannot call yet go in expansion_ideas.
- Flag small_sample zips and conversations under 20 as weak evidence. Past call results are only useful with enough conversations.
- Be concrete and brief. Finish by calling submit_recommendations once; if it returns an error, fix exactly what it lists and submit again.`;

const METRIC_LABELS: Record<RankMetric, string> = {
  listing_likelihood: 'listing likelihood',
  sales_volume: 'sales volume',
  sell_through: 'sell-through',
  sales_momentum: 'sales momentum',
  value_growth: 'home value growth',
  value_decline: 'home value decline',
};

const toolError = (message: string): ToolOut => ({ data: { error: message }, summary: message, isError: true });

export function createMarketTools(ctx: MarketContext): { tools: Record<string, ToolFn>; getSubmission: () => MarketAnalysis | null } {
  let submission: MarketAnalysis | null = null;
  const { rows } = ctx;

  const getMarketOverview: ToolFn = async () => {
    const callable = rows.filter((r) => r.callable);
    const trends = { rising: 0, flat: 0, cooling: 0, falling: 0, unknown: 0 };
    for (const r of rows) trends[r.trend]++;
    const yoy = rows.map((r) => r.pendingYoY).filter((x): x is number => x !== null);
    return {
      data: {
        as_of: marketAsOf(),
        sources: MARKET_SOURCE_NAMES,
        zips_in_dataset: rows.length,
        zips_the_app_can_call: callable.map((r) => ({ zip: r.zip, city: r.city, homeowners: r.local?.homeowners ?? 0 })),
        callable_zips_without_market_data: ctx.uncoveredZips,
        value_trend_counts: trends,
        bay_area_median_pending_sales_yoy_pct: pct(median(yoy)),
        notes: [
          'Pending sales = homes that went under contract, summed over the last 3 months and compared with the same 3 months a year earlier.',
          'sell_through_pct = pending sales divided by active listings (higher means homes sell faster).',
          'small_sample = Realtor.com flags the data as unreliable or there are very few sales; treat its numbers cautiously.',
        ],
      },
      summary: `Looked at ${rows.length} Bay Area zips (${callable.length} you can call)`,
    };
  };

  const rankZipsTool: ToolFn = async (input) => {
    const args = isRecord(input) ? input : {};
    const metric = args.metric;
    if (!RANK_METRICS.includes(metric as RankMetric)) return toolError(`metric must be one of ${RANK_METRICS.join(', ')}.`);
    const requested = Number(args.limit);
    const limit = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 8, 1), 15);
    const callableOnly = args.callable_only === true;
    const ranked = rankZips(rows, metric as RankMetric, { limit, callableOnly, excludeSmallSamples: args.exclude_small_samples === true });
    return {
      data: { metric, callable_only: callableOnly, ranked: ranked.map(zipView) },
      summary: `Ranked zips by ${METRIC_LABELS[metric as RankMetric]}${callableOnly ? ' (your markets only)' : ''}`,
    };
  };

  const getZipDetails: ToolFn = async (input) => {
    const zips = isRecord(input) && Array.isArray(input.zips) ? input.zips.map(String).slice(0, 8) : [];
    if (zips.length === 0) return toolError('zips must be a non-empty array of five-digit zip codes.');
    const byZip = new Map(rows.map((r) => [r.zip, r]));
    const found = zips.map((z) => byZip.get(z)).filter((r): r is ScoredZip => r !== undefined);
    const notFound = zips.filter((z) => !byZip.has(z));
    if (found.length === 0) return toolError(`None of those zips are in the market data: ${notFound.join(', ')}.`);
    return {
      data: { zips: found.map(zipView), not_found: notFound },
      summary: `Read details for ${found.map((r) => r.zip).join(', ')}`,
    };
  };

  const submit: ToolFn = async (input) => {
    const result = validateAnalysis(input, rows);
    if (!result.ok) return toolError(result.error);
    submission = result.value;
    return { data: { ok: true }, summary: 'Submitted recommendations' };
  };

  return {
    tools: {
      get_market_overview: getMarketOverview,
      rank_zips: rankZipsTool,
      get_zip_details: getZipDetails,
      submit_recommendations: submit,
    },
    getSubmission: () => submission,
  };
}

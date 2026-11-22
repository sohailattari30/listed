import { FunctionsHttpError } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from './supabase';

const num = z.number().nullable();

export const ZipViewSchema = z.object({
  zip: z.string(),
  city: z.string(),
  county: z.string(),
  callable: z.boolean(),
  listing_likelihood_score: num,
  median_list_price: num,
  active_listings: num,
  pending_sales_last_3_months: num,
  pending_sales_yoy_pct: num,
  new_listings_yoy_pct: num,
  sell_through_pct: num,
  days_on_market: num,
  price_reduced_pct: num,
  home_value: num,
  home_value_yoy_pct: num,
  home_value_3mo_pct: num,
  value_trend: z.enum(['rising', 'flat', 'cooling', 'falling', 'unknown']),
  small_sample: z.boolean(),
  homeowners_in_app: num,
  owners_10plus_years_pct: num,
  my_conversations: num,
  my_hot_lead_pct: num,
});
export type ZipView = z.infer<typeof ZipViewSchema>;

const Sources = z.object({ realtor: z.string(), zillow: z.string() });

export const MarketsSchema = z.object({
  as_of: Sources,
  sources: Sources,
  your_markets: z.array(ZipViewSchema),
  hottest: z.array(ZipViewSchema),
  falling: z.array(ZipViewSchema),
  unmatched_calls: z.number(),
});
export type Markets = z.infer<typeof MarketsSchema>;

const WhyItem = z.object({ zip: z.string(), city: z.string(), why: z.string() });
export const ACTIONS = ['call_now', 'call_soon', 'watch', 'skip'] as const;
export type Action = (typeof ACTIONS)[number];

export const AnalysisSchema = z.object({
  summary: z.string(),
  selling_most: z.array(WhyItem),
  going_down: z.array(WhyItem),
  recommendations: z.array(z.object({ zip: z.string(), city: z.string(), action: z.enum(ACTIONS), reason: z.string() })),
  expansion_ideas: z.array(WhyItem),
  caveats: z.array(z.string()),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const AdvisorSchema = z.object({
  analysis: AnalysisSchema,
  steps: z.array(z.object({ tool: z.string(), summary: z.string() })),
  as_of: Sources,
  sources: Sources,
});
export type AdvisorResult = z.infer<typeof AdvisorSchema>;

const FALLBACK_MESSAGE = 'The market analyst is unavailable right now.';

async function errorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body: unknown = await error.context.json();
      const parsed = z.object({ error: z.string() }).safeParse(body);
      if (parsed.success) return parsed.data.error;
    } catch {
      // body wasn't JSON
    }
  }
  return FALLBACK_MESSAGE;
}

async function invoke<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai', { body });
  if (error) throw new Error(await errorMessage(error));
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error('The server returned an unexpected response.');
  return parsed.data;
}

export const fetchMarkets = (): Promise<Markets> => invoke({ mode: 'markets' }, MarketsSchema);
export const fetchAdvisor = (): Promise<AdvisorResult> => invoke({ mode: 'advisor' }, AdvisorSchema);

// --- formatting -----------------------------------------------------------

export const formatPct = (n: number | null, digits = 1): string => (n === null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`);

export function formatPrice(n: number | null): string {
  if (n === null) return '–';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  return `$${Math.round(n / 1000)}K`;
}

export const ACTION_LABELS: Record<Action, string> = { call_now: 'Call now', call_soon: 'Call soon', watch: 'Watch', skip: 'Skip' };

export const TREND_LABELS: Record<ZipView['value_trend'], string> = {
  rising: 'Rising',
  flat: 'Flat',
  cooling: 'Cooling',
  falling: 'Falling',
  unknown: 'No data',
};

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';

const invoke = vi.fn();
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } } }));

import { fetchAdvisor, fetchMarkets, formatPct, formatPrice } from './markets';
import { readAdvisorCache, writeAdvisorCache } from './advisorCache';

const zip = {
  zip: '94536', city: 'Fremont', county: 'Alameda', callable: true, listing_likelihood_score: 72, median_list_price: 1345800,
  active_listings: 75, pending_sales_last_3_months: 99, pending_sales_yoy_pct: 6.5, new_listings_yoy_pct: 2, sell_through_pct: 41,
  days_on_market: 37, price_reduced_pct: 10.5, home_value: 1361462, home_value_yoy_pct: -1, home_value_3mo_pct: -0.4,
  value_trend: 'falling', small_sample: false, homeowners_in_app: 120, owners_10plus_years_pct: 58, my_conversations: 40, my_hot_lead_pct: 5,
};
const sources = { realtor: 'Oct 2026', zillow: 'Oct 2026' };
const analysis = {
  summary: 'Call Fremont first.',
  selling_most: [{ zip: '94539', city: 'Fremont', why: '24 pending, up 60%.' }],
  going_down: [],
  recommendations: [{ zip: '94536', city: 'Fremont', action: 'call_now', reason: 'Fast sales, long-tenured owners.' }],
  expansion_ideas: [],
  caveats: ['Pending sales stand in for closed sales.'],
};

const httpError = (body: unknown) => new FunctionsHttpError(new Response(JSON.stringify(body), { status: 502 }));

beforeEach(() => invoke.mockReset());

describe('fetchMarkets', () => {
  const payload = { as_of: sources, sources, your_markets: [zip], hottest: [zip], falling: [], unmatched_calls: 2 };

  it('asks the markets mode and returns validated data', async () => {
    invoke.mockResolvedValue({ data: payload, error: null });
    await expect(fetchMarkets()).resolves.toMatchObject({ your_markets: [{ zip: '94536' }], unmatched_calls: 2 });
    expect(invoke).toHaveBeenCalledWith('ai', { body: { mode: 'markets' } });
  });

  it('rejects a response with a wrong shape instead of rendering garbage', async () => {
    invoke.mockResolvedValue({ data: { ...payload, your_markets: [{ zip: 94536 }] }, error: null });
    await expect(fetchMarkets()).rejects.toThrow('unexpected response');
  });
});

describe('fetchAdvisor', () => {
  it('returns the analysis, the steps taken, and the data dates', async () => {
    invoke.mockResolvedValue({ data: { analysis, steps: [{ tool: 'rank_zips', summary: 'Ranked zips by sales volume' }], as_of: sources, sources }, error: null });
    const result = await fetchAdvisor();
    expect(result.analysis.recommendations[0]?.action).toBe('call_now');
    expect(invoke).toHaveBeenCalledWith('ai', { body: { mode: 'advisor' } });
  });

  it('rejects an action the app does not know how to display', async () => {
    const bad = { analysis: { ...analysis, recommendations: [{ ...analysis.recommendations[0], action: 'yolo' }] }, steps: [], as_of: sources, sources };
    invoke.mockResolvedValue({ data: bad, error: null });
    await expect(fetchAdvisor()).rejects.toThrow('unexpected response');
  });

  it('shows the server message, and a plain fallback for network failures', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError({ error: 'The analyst took too many steps. Try again.' }) });
    await expect(fetchAdvisor()).rejects.toThrow('The analyst took too many steps. Try again.');
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    await expect(fetchAdvisor()).rejects.toThrow('unavailable right now');
  });
});

describe('formatting', () => {
  it('formats percentages with a sign and handles missing values', () => {
    expect(formatPct(6.54)).toBe('+6.5%');
    expect(formatPct(-1.04)).toBe('-1.0%');
    expect(formatPct(0)).toBe('0.0%');
    expect(formatPct(null)).toBe('–');
  });
  it('formats prices compactly', () => {
    expect(formatPrice(1345800)).toBe('$1.35M');
    expect(formatPrice(5000000)).toBe('$5M');
    expect(formatPrice(834000)).toBe('$834K');
    expect(formatPrice(null)).toBe('–');
  });
});

describe('advisor cache', () => {
  class MemoryStorage {
    data = new Map<string, string>();
    getItem(k: string) {
      return this.data.get(k) ?? null;
    }
    setItem(k: string, v: string) {
      this.data.set(k, v);
    }
  }
  const result = { analysis, steps: [], as_of: sources, sources } as never;
  const morning = new Date(2026, 10, 22, 9);

  it('keeps today\'s analysis and drops it tomorrow', () => {
    const storage = new MemoryStorage();
    writeAdvisorCache(storage, result, morning);
    expect(readAdvisorCache(storage, new Date(2026, 10, 22, 22))?.result.analysis.summary).toBe('Call Fremont first.');
    expect(readAdvisorCache(storage, new Date(2026, 10, 23, 9))).toBeNull();
  });

  it('ignores corrupt data', () => {
    const storage = new MemoryStorage();
    storage.setItem('listed_advisor', '{nope');
    expect(readAdvisorCache(storage, morning)).toBeNull();
  });
});

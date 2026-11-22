import { describe, expect, it } from 'vitest';
import { runAgent, type Message, type ModelTurn } from './agent-loop.ts';
import { mkZip, pendingTrend } from './fixtures.ts';
import { computeMetrics } from './market.ts';
import { buildMarketsView, createMarketTools, loadScored, validateAnalysis, zipView, type LocalData } from './market-tools.ts';

const metrics = [
  computeMetrics(mkZip('94536', { city: 'Fremont', pending: pendingTrend(10, 14), zhviNow: 1_360_000, zhviYearAgo: 1_376_000 })),
  computeMetrics(mkZip('94587', { city: 'Union City', pending: pendingTrend(10, 8), zhviNow: 1_190_000, zhviYearAgo: 1_210_000 })),
  computeMetrics(mkZip('94022', { city: 'Los Altos', pending: pendingTrend(8, 12), zhviNow: 5_170_000, zhviYearAgo: 4_780_000 })),
  computeMetrics(mkZip('94539', { city: 'Fremont', pending: pendingTrend(10, 16), zhviNow: 2_160_000, zhviYearAgo: 2_110_000 })),
];

const fakeLocal = (overrides: Partial<LocalData> = {}): LocalData => ({
  homeownerTenures: async () => [
    { zip: '94536', years_owned: 15 },
    { zip: '94536', years_owned: 22 },
    { zip: '94536', years_owned: 3 },
    { zip: '94587', years_owned: 4 },
    { zip: '99999', years_owned: 30 },
  ],
  calls: async () => [
    { homeowner_id: 'h1', outcome: 'sell' },
    { homeowner_id: 'h2', outcome: 'no' },
    { homeowner_id: 'o1', outcome: 'sell' },
    { homeowner_id: 'h1', outcome: 'skip' },
  ],
  homeowners: async (ids) => ids.filter((id) => id === 'h1' || id === 'h2').map((id) => ({ id, zip: '94536', years_owned: 15 })),
  ...overrides,
});

const context = () => loadScored(fakeLocal(), metrics);

describe('loadScored', () => {
  it('joins market data with the homeowners the app can call and this user\'s own results', async () => {
    const ctx = await context();
    const fremont = ctx.rows.find((r) => r.zip === '94536')!;
    expect(fremont.callable).toBe(true);
    expect(fremont.local).toMatchObject({ homeowners: 3 });
    expect(fremont.personal).toMatchObject({ conversations: 2, hot: 1 });
    expect(ctx.rows.find((r) => r.zip === '94022')?.callable).toBe(false);
  });

  it('reports callable zips the market data does not cover, and calls with no matching homeowner', async () => {
    const ctx = await context();
    expect(ctx.uncoveredZips).toEqual(['99999']);
    expect(ctx.unmatchedCalls).toBe(1);
  });

  it('does not look up homeowners when there are no calls', async () => {
    let looked = false;
    await loadScored(fakeLocal({ calls: async () => [], homeowners: async () => ((looked = true), []) }), metrics);
    expect(looked).toBe(false);
  });
});

describe('zipView', () => {
  it('exposes readable percentages, not raw fractions', async () => {
    const ctx = await context();
    const v = zipView(ctx.rows.find((r) => r.zip === '94536')!);
    expect(v.pending_sales_yoy_pct).toBe(40);
    expect(v.home_value_yoy_pct).toBe(-1.2);
    expect(v.owners_10plus_years_pct).toBe(66.7);
    expect(v.value_trend).toBe('falling');
  });
});

describe('buildMarketsView', () => {
  it('lists your markets, the hottest zips, and only zips whose values are actually falling', async () => {
    const view = buildMarketsView(await context());
    expect(view.your_markets.map((z) => z.zip).sort()).toEqual(['94536', '94587']);
    expect(view.your_markets.every((z) => z.callable)).toBe(true);
    expect(view.falling.map((z) => z.zip).sort()).toEqual(['94536', '94587']);
    expect(view.hottest.length).toBeGreaterThan(0);
    expect(view.as_of.realtor).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
  });
});

describe('tools', () => {
  it('get_market_overview lists what the agent can call and how the metrics are defined', async () => {
    const { tools } = createMarketTools(await context());
    const out = await tools.get_market_overview!({});
    const data = out.data as { zips_the_app_can_call: { zip: string }[]; callable_zips_without_market_data: string[]; notes: string[] };
    expect(data.zips_the_app_can_call.map((z) => z.zip).sort()).toEqual(['94536', '94587']);
    expect(data.callable_zips_without_market_data).toEqual(['99999']);
    expect(data.notes.length).toBeGreaterThan(0);
    expect(out.summary).toBe('Looked at 4 Bay Area zips (2 you can call)');
  });

  it('rank_zips ranks, clamps the limit, and honours callable_only', async () => {
    const { tools } = createMarketTools(await context());
    const top = await tools.rank_zips!({ metric: 'sales_volume', limit: 999 });
    expect((top.data as { ranked: unknown[] }).ranked).toHaveLength(4);
    const mine = await tools.rank_zips!({ metric: 'sales_volume', callable_only: true, limit: 0 });
    expect((mine.data as { ranked: { zip: string }[] }).ranked.map((z) => z.zip)).toEqual(['94536', '94587']);
    expect(mine.summary).toBe('Ranked zips by sales volume (your markets only)');
  });

  it('rank_zips rejects an unknown metric with a message the model can act on', async () => {
    const { tools } = createMarketTools(await context());
    const out = await tools.rank_zips!({ metric: 'vibes' });
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out.data)).toContain('listing_likelihood');
  });

  it('get_zip_details returns details, reports unknown zips, and errors when nothing matches', async () => {
    const { tools } = createMarketTools(await context());
    const out = await tools.get_zip_details!({ zips: ['94536', '00000'] });
    expect((out.data as { zips: { zip: string }[]; not_found: string[] }).zips.map((z) => z.zip)).toEqual(['94536']);
    expect((out.data as { not_found: string[] }).not_found).toEqual(['00000']);
    expect((await tools.get_zip_details!({ zips: ['00000'] })).isError).toBe(true);
    expect((await tools.get_zip_details!({})).isError).toBe(true);
  });
});

describe('validateAnalysis', () => {
  const rowsPromise = context().then((c) => c.rows);
  const good = {
    summary: 'Fremont is moving fastest.',
    selling_most: [{ zip: '94539', why: '48 pending sales, up 60% year over year.' }],
    going_down: [{ zip: '94587', why: 'Values down 1.7% over 12 months.' }],
    recommendations: [{ zip: '94536', action: 'call_now', reason: 'Fast sales and long-tenured owners.' }],
    expansion_ideas: [{ zip: '94539', why: 'Hot market you have no homeowner data for.' }],
    caveats: ['Pending sales stand in for closed sales.'],
  };

  it('accepts a valid answer and fills in each zip\'s city', async () => {
    const result = validateAnalysis(good, await rowsPromise);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recommendations[0]).toMatchObject({ zip: '94536', city: 'Fremont', action: 'call_now' });
    expect(result.value.going_down[0]?.city).toBe('Union City');
  });

  it('rejects a zip that is not in the data', async () => {
    const bad = { ...good, selling_most: [{ zip: '12345', why: 'made up' }] };
    expect(validateAnalysis(bad, await rowsPromise)).toMatchObject({ ok: false, error: expect.stringContaining('"12345" is not in the market data') });
  });

  it('will not tell the agent to call a zip the app has no homeowners for', async () => {
    const bad = { ...good, recommendations: [{ zip: '94022', action: 'call_now', reason: 'Hot' }] };
    expect(validateAnalysis(bad, await rowsPromise)).toMatchObject({ ok: false, error: expect.stringContaining('cannot be called yet') });
  });

  it('allows "watch" for a zip that cannot be called yet', async () => {
    const watch = { ...good, recommendations: [{ zip: '94022', action: 'watch', reason: 'Values up 8%.' }] };
    expect(validateAnalysis(watch, await rowsPromise).ok).toBe(true);
  });

  it('keeps zips you can already call out of expansion ideas', async () => {
    const bad = { ...good, expansion_ideas: [{ zip: '94536', why: 'x' }] };
    expect(validateAnalysis(bad, await rowsPromise)).toMatchObject({ ok: false, error: expect.stringContaining('already callable') });
  });

  it('rejects duplicates, bad actions, too many items, and empty text, and reports every problem at once', async () => {
    const bad = {
      summary: '',
      selling_most: Array(6).fill({ zip: '94536', why: 'x' }),
      going_down: [],
      recommendations: [
        { zip: '94536', action: 'call_now', reason: 'a' },
        { zip: '94536', action: 'call_soon', reason: 'b' },
        { zip: '94587', action: 'maybe', reason: 'c' },
      ],
      expansion_ideas: [],
      caveats: [''],
    };
    const result = validateAnalysis(bad, await rowsPromise);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('summary');
    expect(result.error).toContain('selling_most');
    expect(result.error).toContain('appears twice');
    expect(result.error).toContain('action must be one of');
  });

  it('rejects input that is not an object', async () => {
    expect(validateAnalysis('nope', await rowsPromise).ok).toBe(false);
    expect(validateAnalysis(null, await rowsPromise).ok).toBe(false);
  });
});

describe('the analyst, end to end with a scripted model', () => {
  const toolUse = (id: string, name: string, input: unknown = {}) => ({ type: 'tool_use', id, name, input });

  it('researches with tools, gets a bad submission rejected, fixes it, and finishes on a valid one', async () => {
    const { tools, getSubmission } = createMarketTools(await context());
    const calls: Message[][] = [];
    const script: ModelTurn[] = [
      { stop_reason: 'tool_use', content: [toolUse('1', 'get_market_overview'), toolUse('2', 'rank_zips', { metric: 'value_decline' })] },
      {
        stop_reason: 'tool_use',
        content: [toolUse('3', 'submit_recommendations', { summary: 's', selling_most: [], going_down: [], recommendations: [{ zip: '94022', action: 'call_now', reason: 'r' }], expansion_ideas: [], caveats: [] })],
      },
      {
        stop_reason: 'tool_use',
        content: [toolUse('4', 'submit_recommendations', { summary: 'Call Fremont first.', selling_most: [], going_down: [{ zip: '94587', why: 'down 1.7%' }], recommendations: [{ zip: '94536', action: 'call_now', reason: 'fast' }], expansion_ideas: [{ zip: '94022', why: 'hot, no data' }], caveats: [] })],
      },
    ];
    let i = 0;
    const result = await runAgent({
      firstMessage: 'analyze',
      maxTurns: 6,
      stopAfter: 'submit_recommendations',
      tools,
      createTurn: async (messages) => {
        calls.push(messages);
        return script[i++]!;
      },
    });

    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.tool)).toEqual(['get_market_overview', 'rank_zips', 'submit_recommendations']);
    expect(getSubmission()?.recommendations[0]).toMatchObject({ zip: '94536', city: 'Fremont', action: 'call_now' });
    expect(calls).toHaveLength(3);

    const rejection = (calls[2]![calls[2]!.length - 1]!.content as unknown as { is_error?: boolean; content: string }[])[0]!;
    expect(rejection.is_error).toBe(true);
    expect(rejection.content).toContain('cannot be called yet');
  });
});

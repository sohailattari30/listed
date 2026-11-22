import { describe, expect, it } from 'vitest';
import { buildLocalIndex } from './analytics.ts';
import { classifyTrend, computeMetrics, formatIsoMonth, formatYyyymm, rankZips, scoreAll, SCORE_WEIGHTS } from './market.ts';
import { mkZip, pendingTrend } from './fixtures.ts';

describe('classifyTrend', () => {
  it.each([
    [-0.03, 0, 'falling'],
    [-0.0101, 0.02, 'falling'],
    [0.0, -0.01, 'cooling'],
    [0.05, -0.01, 'cooling'],
    [0.05, 0.01, 'rising'],
    [0.05, null, 'rising'],
    [0.005, 0.0, 'flat'],
    [null, 0.02, 'unknown'],
  ] as const)('yoy %s, 3-month %s -> %s', (yoy, m3, expected) => {
    expect(classifyTrend(yoy, m3)).toBe(expected);
  });
});

describe('computeMetrics', () => {
  it('compares the last 3 months of pending sales with the same 3 months a year earlier', () => {
    const m = computeMetrics(mkZip('94536', { pending: pendingTrend(10, 15) }));
    expect(m.pending3m).toBe(45);
    expect(m.pendingYoY).toBeCloseTo(0.5);
  });

  it('reads sell-through, days on market and price cuts as 3-month averages', () => {
    const m = computeMetrics(mkZip('94536', { pending: 20, active: 40, dom: 30, reduced: 0.2 }));
    expect(m.pendingRatio3m).toBeCloseTo(0.5);
    expect(m.daysOnMarket3m).toBe(30);
    expect(m.priceReducedShare3m).toBeCloseTo(0.2);
  });

  it('measures home values over 12 months and over the last 3', () => {
    const m = computeMetrics(mkZip('94536', { zhviNow: 1_320_000, zhviYearAgo: 1_200_000, zhviThreeAgo: 1_300_000 }));
    expect(m.valueYoY).toBeCloseTo(0.1);
    expect(m.value3m).toBeCloseTo(20_000 / 1_300_000);
    expect(m.trend).toBe('rising');
  });

  it('labels a falling market from the numbers', () => {
    expect(computeMetrics(mkZip('94587', { zhviNow: 1_190_000, zhviYearAgo: 1_210_000 })).trend).toBe('falling');
  });

  it('refuses a year-over-year change when the history has a gap', () => {
    const months = [202508, 202509, 202510, 202511, 202512, 202601, 202602, 202603, 202604, 202605, 202606, 202607, 202609, 202610, 202611];
    expect(computeMetrics(mkZip('94536', { months, pending: pendingTrend(10, 15) })).pendingYoY).toBeNull();
  });

  it('has no year-over-year with under 15 months of history', () => {
    const months = [202604, 202605, 202606, 202607, 202608, 202609, 202610];
    const m = computeMetrics(mkZip('94536', { months }));
    expect(m.pendingYoY).toBeNull();
    expect(m.pending3m).toBe(30);
  });

  it('flags small samples: Realtor.com quality flag or very few sales', () => {
    expect(computeMetrics(mkZip('a', { pending: 10 })).lowSample).toBe(false);
    expect(computeMetrics(mkZip('b', { pending: 10, quality: 1 })).lowSample).toBe(true);
    expect(computeMetrics(mkZip('c', { pending: 2 })).lowSample).toBe(true);
  });
});

describe('scoreAll', () => {
  const none = new Map();
  const metrics = [
    computeMetrics(mkZip('hot', { pending: pendingTrend(10, 20), active: 40, dom: 20 })),
    computeMetrics(mkZip('mid', { pending: pendingTrend(10, 12), active: 40, dom: 35 })),
    computeMetrics(mkZip('cold', { pending: pendingTrend(14, 8), active: 80, dom: 60 })),
  ];
  const score = (rows: ReturnType<typeof scoreAll>, zip: string) => rows.find((r) => r.zip === zip)?.score ?? -1;

  it('scores hotter, accelerating, faster-selling markets higher', () => {
    const rows = scoreAll(metrics, none, none);
    expect(score(rows, 'hot')).toBeGreaterThan(score(rows, 'mid'));
    expect(score(rows, 'mid')).toBeGreaterThan(score(rows, 'cold'));
    for (const r of rows) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('marks only zips the app has homeowners for as callable', () => {
    const local = buildLocalIndex([{ zip: 'mid', years_owned: 12 }]);
    const rows = scoreAll(metrics, local, none);
    expect(rows.map((r) => [r.zip, r.callable])).toEqual([
      ['hot', false],
      ['mid', true],
      ['cold', false],
    ]);
  });

  it('rewards a zip whose homeowners have owned a long time', () => {
    const veterans = buildLocalIndex([{ zip: 'mid', years_owned: 20 }, { zip: 'mid', years_owned: 15 }]);
    const newcomers = buildLocalIndex([{ zip: 'mid', years_owned: 1 }, { zip: 'mid', years_owned: 2 }]);
    expect(score(scoreAll(metrics, veterans, none), 'mid')).toBeGreaterThan(score(scoreAll(metrics, newcomers, none), 'mid'));
  });

  it('still scores zips without local data, using market signals only', () => {
    const rows = scoreAll(metrics, none, none);
    expect(rows.every((r) => r.score !== null && r.components.tenure === null)).toBe(true);
  });

  it('gives no score when there is no market signal at all', () => {
    const empty = computeMetrics(mkZip('empty', { months: [202610] }));
    const blank = { ...empty, pendingRatio3m: null, pendingYoY: null, daysOnMarket3m: 30 };
    expect(scoreAll([blank], none, none)[0]?.score).toBeNull();
  });

  it('weights sum to 1', () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe('rankZips', () => {
  const none = new Map();
  const local = buildLocalIndex([{ zip: 'b', years_owned: 12 }]);
  const rows = scoreAll(
    [
      computeMetrics(mkZip('a', { pending: 30, zhviNow: 1_100_000, zhviYearAgo: 1_000_000 })),
      computeMetrics(mkZip('b', { pending: 20, zhviNow: 950_000, zhviYearAgo: 1_000_000 })),
      computeMetrics(mkZip('c', { pending: 20, quality: 1, zhviNow: 900_000, zhviYearAgo: 1_000_000 })),
      computeMetrics(mkZip('d', { pending: 3, zhviNow: 1_000_000, zhviYearAgo: 1_000_000 })),
    ],
    local,
    none,
  );

  it('ranks by volume, breaking ties by zip', () => {
    expect(rankZips(rows, 'sales_volume', { limit: 10 }).map((r) => r.zip)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ranks the biggest value declines first and the biggest gains first', () => {
    expect(rankZips(rows, 'value_decline', { limit: 2 }).map((r) => r.zip)).toEqual(['c', 'b']);
    expect(rankZips(rows, 'value_growth', { limit: 1 }).map((r) => r.zip)).toEqual(['a']);
  });

  it('can limit to callable zips and skip small samples', () => {
    expect(rankZips(rows, 'sales_volume', { limit: 10, callableOnly: true }).map((r) => r.zip)).toEqual(['b']);
    expect(rankZips(rows, 'sales_volume', { limit: 10, excludeSmallSamples: true }).map((r) => r.zip)).toEqual(['a', 'b']);
  });

  it('leaves out zips that have no value for the metric', () => {
    const noMomentum = scoreAll([computeMetrics(mkZip('x', { months: [202610] }))], none, none);
    expect(rankZips(noMomentum, 'sales_momentum', { limit: 5 })).toEqual([]);
  });
});

describe('month labels', () => {
  it('formats both source date styles', () => {
    expect(formatYyyymm(202610)).toBe('Oct 2026');
    expect(formatIsoMonth('2026-01')).toBe('Jan 2026');
  });
});

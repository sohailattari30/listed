// Turns the raw market snapshot into comparable metrics, a transparent listing-likelihood score,
// and rankings. Pure functions: the agent explains these numbers, it never computes them.

import { MARKET_DATA, MARKET_SOURCES, type RawZipMarket, type RcRow } from './market-data.ts';
import { percentileRank, type LocalZip, type PersonalZip } from './analytics.ts';

export type Trend = 'rising' | 'flat' | 'cooling' | 'falling' | 'unknown';

/** Index into an RcRow (see RC_COLUMNS in market-data.ts). */
const COL = { month: 0, price: 1, active: 2, dom: 3, newListings: 4, pending: 5, pendingRatio: 6, reduced: 7, quality: 8 } as const;

/** Fewer pending sales than this over three months is too noisy to trust a year-over-year change. */
const MIN_PENDING_3M = 12;

export interface ZipMetrics {
  zip: string;
  city: string;
  county: string;
  medianListPrice: number | null;
  activeListings: number | null;
  /** Homes that went under contract in the last 3 months (a proxy for sales). */
  pending3m: number | null;
  /** Change versus the same 3 months a year earlier, as a fraction (0.1 = +10%). */
  pendingYoY: number | null;
  newListingsYoY: number | null;
  /** Pending sales divided by active listings, averaged over 3 months. Higher = homes move faster. */
  pendingRatio3m: number | null;
  daysOnMarket3m: number | null;
  priceReducedShare3m: number | null;
  valueNow: number | null;
  valueYoY: number | null;
  value3m: number | null;
  trend: Trend;
  lowSample: boolean;
}

export interface ScoreComponents {
  sellThrough: number | null;
  momentum: number | null;
  speed: number | null;
  tenure: number | null;
}

export interface ScoredZip extends ZipMetrics {
  /** 0-100, or null when there is too little data. */
  score: number | null;
  components: ScoreComponents;
  callable: boolean;
  local: LocalZip | null;
  personal: PersonalZip | null;
}

const at = (row: RcRow | undefined, col: number): number | null => (row ? (row[col] ?? null) : null);

const avg = (xs: ReadonlyArray<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

const sumOf = (rows: readonly RcRow[], col: number): number | null => {
  if (rows.length !== 3) return null;
  let total = 0;
  for (const row of rows) {
    const x = at(row, col);
    if (x === null) return null;
    total += x;
  }
  return total;
};

const pctChange = (now: number | null, then: number | null): number | null => (now !== null && then !== null && then > 0 ? now / then - 1 : null);

/**
 * `yoy`: change in the Zillow home value index over 12 months. `m3`: change over the last 3 months.
 * Thresholds are judgment calls, so the numbers are always shown next to the label.
 */
export function classifyTrend(yoy: number | null, m3: number | null): Trend {
  if (yoy === null) return 'unknown';
  if (yoy < -0.01) return 'falling';
  if (m3 !== null && m3 < -0.005) return 'cooling';
  if (yoy > 0.01 && (m3 === null || m3 >= 0)) return 'rising';
  return 'flat';
}

export function computeMetrics(raw: RawZipMarket): ZipMetrics {
  const rc = raw.rc;
  const n = rc.length;
  const latest = rc[n - 1];
  const last3 = rc.slice(-3);
  // Same three calendar months a year earlier, but only if the history has no gaps.
  const prior3 = n >= 15 ? rc.slice(n - 15, n - 12) : [];
  const aligned = prior3.length === 3 && last3.length === 3 && (prior3[2]?.[COL.month] ?? 0) === (last3[2]?.[COL.month] ?? 0) - 100;

  const pending3m = sumOf(last3, COL.pending);
  const pendingYoY = aligned ? pctChange(pending3m, sumOf(prior3, COL.pending)) : null;
  const newYoY = aligned ? pctChange(sumOf(last3, COL.newListings), sumOf(prior3, COL.newListings)) : null;

  const z = raw.zhvi;
  const valueNow = z[z.length - 1] ?? null;
  const valueYoY = z.length >= 13 ? pctChange(valueNow, z[z.length - 13] ?? null) : null;
  const value3m = z.length >= 4 ? pctChange(valueNow, z[z.length - 4] ?? null) : null;

  return {
    zip: raw.zip,
    city: raw.city,
    county: raw.county,
    medianListPrice: at(latest, COL.price),
    activeListings: at(latest, COL.active),
    pending3m,
    pendingYoY,
    newListingsYoY: newYoY,
    pendingRatio3m: avg(last3.map((r) => at(r, COL.pendingRatio))),
    daysOnMarket3m: avg(last3.map((r) => at(r, COL.dom))),
    priceReducedShare3m: avg(last3.map((r) => at(r, COL.reduced))),
    valueNow,
    valueYoY,
    value3m,
    trend: classifyTrend(valueYoY, value3m),
    lowSample: at(latest, COL.quality) === 1 || (pending3m ?? 0) < MIN_PENDING_3M,
  };
}

export const loadMetrics = (data: readonly RawZipMarket[] = MARKET_DATA): ZipMetrics[] => data.map(computeMetrics);

/**
 * Listing likelihood is a heuristic, not a trained model: how fast homes are moving in the zip,
 * whether that is accelerating, how quickly listings sell, and how many of the app's homeowners
 * have owned 10+ years. Weights are renormalised over whatever data a zip has.
 */
export const SCORE_WEIGHTS = { sellThrough: 0.35, momentum: 0.25, speed: 0.1, tenure: 0.3 } as const;

export function scoreAll(
  metrics: readonly ZipMetrics[],
  local: ReadonlyMap<string, LocalZip>,
  personal: ReadonlyMap<string, PersonalZip>,
): ScoredZip[] {
  const ratios = metrics.map((m) => m.pendingRatio3m);
  const momentum = metrics.map((m) => m.pendingYoY);
  const days = metrics.map((m) => m.daysOnMarket3m);

  return metrics.map((m) => {
    const loc = local.get(m.zip) ?? null;
    const components: ScoreComponents = {
      sellThrough: m.pendingRatio3m === null ? null : percentileRank(ratios, m.pendingRatio3m),
      momentum: m.pendingYoY === null ? null : percentileRank(momentum, m.pendingYoY),
      speed: m.daysOnMarket3m === null ? null : 1 - percentileRank(days, m.daysOnMarket3m),
      tenure: loc ? loc.longTenureShare : null,
    };
    let weighted = 0;
    let weight = 0;
    for (const key of Object.keys(SCORE_WEIGHTS) as (keyof ScoreComponents)[]) {
      const c = components[key];
      if (c === null) continue;
      weighted += c * SCORE_WEIGHTS[key];
      weight += SCORE_WEIGHTS[key];
    }
    // Market signals are the core; without sell-through and momentum there is nothing to score.
    const hasMarket = components.sellThrough !== null || components.momentum !== null;
    return {
      ...m,
      score: hasMarket && weight > 0 ? (weighted / weight) * 100 : null,
      components,
      callable: loc !== null,
      local: loc,
      personal: personal.get(m.zip) ?? null,
    };
  });
}

export type RankMetric = 'listing_likelihood' | 'sales_volume' | 'sell_through' | 'sales_momentum' | 'value_growth' | 'value_decline';

export const RANK_METRICS: readonly RankMetric[] = ['listing_likelihood', 'sales_volume', 'sell_through', 'sales_momentum', 'value_growth', 'value_decline'];

const SORTERS: Record<RankMetric, { get: (z: ScoredZip) => number | null; dir: 'desc' | 'asc' }> = {
  listing_likelihood: { get: (z) => z.score, dir: 'desc' },
  sales_volume: { get: (z) => z.pending3m, dir: 'desc' },
  sell_through: { get: (z) => z.pendingRatio3m, dir: 'desc' },
  sales_momentum: { get: (z) => z.pendingYoY, dir: 'desc' },
  value_growth: { get: (z) => z.valueYoY, dir: 'desc' },
  value_decline: { get: (z) => z.valueYoY, dir: 'asc' },
};

export function rankZips(
  rows: readonly ScoredZip[],
  metric: RankMetric,
  opts: { limit: number; callableOnly?: boolean; excludeSmallSamples?: boolean },
): ScoredZip[] {
  const { get, dir } = SORTERS[metric];
  return rows
    .filter((r) => (!opts.callableOnly || r.callable) && (!opts.excludeSmallSamples || !r.lowSample) && get(r) !== null)
    .sort((a, b) => {
      const x = get(a) as number;
      const y = get(b) as number;
      return (dir === 'desc' ? y - x : x - y) || a.zip.localeCompare(b.zip);
    })
    .slice(0, opts.limit);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 202610 -> "Oct 2026" */
export const formatYyyymm = (yyyymm: number): string => `${MONTHS[(yyyymm % 100) - 1] ?? '?'} ${Math.floor(yyyymm / 100)}`;
/** "2026-10" -> "Oct 2026" */
export const formatIsoMonth = (iso: string): string => {
  const [y, m] = iso.split('-').map(Number);
  return y && m ? formatYyyymm(y * 100 + m) : iso;
};

export const marketAsOf = () => ({
  realtor: formatYyyymm(MARKET_SOURCES.realtorAsOf),
  zillow: formatIsoMonth(MARKET_SOURCES.zhviAsOf),
});

export const MARKET_SOURCE_NAMES = { realtor: MARKET_SOURCES.realtor, zillow: MARKET_SOURCES.zillow };

// Test helpers: build small, hand-checkable markets (15 months, oldest first).
import type { RawZipMarket, RcRow } from './market-data.ts';

export const MONTHS_15 = [202508, 202509, 202510, 202511, 202512, 202601, 202602, 202603, 202604, 202605, 202606, 202607, 202608, 202609, 202610];

interface ZipOptions {
  city?: string;
  county?: string;
  /** One number for every month, or exactly 15. */
  pending?: number | number[];
  active?: number;
  dom?: number;
  newListings?: number | number[];
  reduced?: number;
  quality?: number;
  zhviNow?: number;
  zhviYearAgo?: number;
  zhviThreeAgo?: number;
  months?: number[];
}

const series = (v: number | number[] | undefined, n: number, fallback: number): number[] => (Array.isArray(v) ? v : Array(n).fill(v ?? fallback));

export function mkZip(zip: string, o: ZipOptions = {}): RawZipMarket {
  const months = o.months ?? MONTHS_15;
  const pending = series(o.pending, months.length, 10);
  const fresh = series(o.newListings, months.length, 10);
  const active = o.active ?? 40;
  const rc: RcRow[] = months.map((m, i) => [m, 1_000_000, active, o.dom ?? 35, fresh[i] ?? 10, pending[i] ?? 10, (pending[i] ?? 10) / active, o.reduced ?? 0.1, o.quality ?? 0]);

  const now = o.zhviNow ?? 1_000_000;
  const yearAgo = o.zhviYearAgo ?? now;
  const zhvi: (number | null)[] = Array(15).fill(null);
  zhvi[2] = yearAgo;
  zhvi[11] = o.zhviThreeAgo ?? now;
  zhvi[14] = now;
  return { zip, city: o.city ?? `City ${zip}`, county: o.county ?? 'Alameda', metro: 'San Jose-Sunnyvale-Santa Clara, CA', rc, zhvi };
}

/** Pending sales of `prior` for the first 3 months of history and `now` for the latest 3, filler in between. */
export const pendingTrend = (prior: number, now: number): number[] => [prior, prior, prior, ...Array(9).fill(prior), now, now, now];

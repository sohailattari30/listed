// Pure helpers. No Deno or Supabase imports, so they run (and are tested) under Node.

export type Id = string | number;

/** Homeowners who have owned this long are the "long-term owners" the app calls. */
export const LONG_TENURE_YEARS = 10;

export interface LocalZip {
  zip: string;
  homeowners: number;
  longTenureShare: number;
  medianTenureYears: number;
}

export interface PersonalZip {
  zip: string;
  conversations: number;
  hot: number;
  hotRate: number;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** What the app can actually dial: per zip, how many homeowners and how long they have owned. */
export function buildLocalIndex(rows: ReadonlyArray<{ zip: string; years_owned: number }>): Map<string, LocalZip> {
  const years = new Map<string, number[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.years_owned)) continue;
    const key = String(row.zip);
    const list = years.get(key);
    if (list) list.push(row.years_owned);
    else years.set(key, [row.years_owned]);
  }
  const out = new Map<string, LocalZip>();
  for (const [zip, list] of years) {
    out.set(zip, {
      zip,
      homeowners: list.length,
      longTenureShare: list.filter((y) => y >= LONG_TENURE_YEARS).length / list.length,
      medianTenureYears: median(list) ?? 0,
    });
  }
  return out;
}

/** This user's own results per zip. Skips do not count; calls whose homeowner no longer exists are tallied separately. */
export function personalByZip(
  calls: ReadonlyArray<{ homeowner_id: Id; outcome: string }>,
  owners: ReadonlyMap<Id, { zip: string }>,
): { byZip: Map<string, PersonalZip>; unmatched: number } {
  const tally = new Map<string, { conversations: number; hot: number }>();
  let unmatched = 0;
  for (const call of calls) {
    if (call.outcome === 'skip') continue;
    const owner = owners.get(call.homeowner_id);
    if (!owner) {
      unmatched++;
      continue;
    }
    const zip = String(owner.zip);
    const t = tally.get(zip) ?? { conversations: 0, hot: 0 };
    t.conversations++;
    if (call.outcome === 'sell') t.hot++;
    tally.set(zip, t);
  }
  const byZip = new Map<string, PersonalZip>();
  for (const [zip, t] of tally) byZip.set(zip, { zip, ...t, hotRate: t.hot / t.conversations });
  return { byZip, unmatched };
}

/** Where `v` sits among `values` from 0 to 1 (ties count half). Nulls are ignored. */
export function percentileRank(values: ReadonlyArray<number | null>, v: number): number {
  let below = 0;
  let equal = 0;
  let n = 0;
  for (const x of values) {
    if (x === null) continue;
    n++;
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return n === 0 ? 0.5 : (below + equal / 2) / n;
}

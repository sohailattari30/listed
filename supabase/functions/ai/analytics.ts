// Pure analytics helpers. No Deno or Supabase imports so they run (and are tested) under Node.

export type Id = string | number;
export type Outcome = 'sell' | 'vm' | 'no' | 'skip';
export type OutcomeTally = Record<Outcome, number>;
export type Segment = 'tenure' | 'zip';

export interface SegmentRow {
  segment: string;
  calls: number;
  hot: number;
  hot_lead_rate: number | null;
}

export function tallyOutcomes(rows: ReadonlyArray<{ outcome: string }>): OutcomeTally {
  const tally: OutcomeTally = { sell: 0, vm: 0, no: 0, skip: 0 };
  for (const row of rows) {
    if (Object.hasOwn(tally, row.outcome)) tally[row.outcome as Outcome]++;
  }
  return tally;
}

/** Share of real conversations (not skips) that were hot leads. */
export function hotLeadRate(tally: OutcomeTally): number | null {
  const logged = tally.sell + tally.vm + tally.no;
  return logged === 0 ? null : tally.sell / logged;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Consecutive UTC days with a session, ending today. If there is no session today yet the
 * streak is still alive, so counting starts from yesterday.
 */
export function currentStreak(sessionDates: Iterable<string>, now: Date = new Date()): number {
  const days = new Set(sessionDates);
  const cursor = new Date(now);
  if (!days.has(isoDay(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(isoDay(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function tenureBucket(years: number): string {
  if (!Number.isFinite(years)) return 'unknown';
  if (years < 5) return '0-4 years';
  if (years < 10) return '5-9 years';
  if (years < 20) return '10-19 years';
  return '20+ years';
}

export function groupConversion(
  calls: ReadonlyArray<{ homeowner_id: Id; outcome: string }>,
  owners: ReadonlyMap<Id, { zip: string; years_owned: number }>,
  segment: Segment,
): SegmentRow[] {
  const groups = new Map<string, { calls: number; hot: number }>();
  for (const call of calls) {
    if (call.outcome === 'skip') continue;
    const owner = owners.get(call.homeowner_id);
    if (!owner) continue;
    const key = segment === 'zip' ? String(owner.zip) : tenureBucket(Number(owner.years_owned));
    const group = groups.get(key) ?? { calls: 0, hot: 0 };
    group.calls++;
    if (call.outcome === 'sell') group.hot++;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([name, g]) => ({
      segment: name,
      calls: g.calls,
      hot: g.hot,
      hot_lead_rate: g.calls ? g.hot / g.calls : null,
    }))
    .sort((a, b) => b.calls - a.calls || a.segment.localeCompare(b.segment));
}

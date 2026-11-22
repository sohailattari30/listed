import { describe, expect, it } from 'vitest';
import { createCoachTools, type CoachData } from './coach-tools.ts';

function fakeData(overrides: Partial<CoachData> = {}): CoachData & { sessionLimits: number[] } {
  const sessionLimits: number[] = [];
  return {
    sessionLimits,
    calls: async () => [
      { homeowner_id: 1, outcome: 'sell' },
      { homeowner_id: 1, outcome: 'vm' },
      { homeowner_id: 2, outcome: 'no' },
      { homeowner_id: 3, outcome: 'skip' },
    ],
    sessions: async (limit) => {
      sessionLimits.push(limit);
      return [
        { session_date: '2026-11-21', calls_made: 50, hot_leads: 2 },
        { session_date: '2026-11-20', calls_made: 50, hot_leads: 1 },
      ];
    },
    homeowners: async (ids) => ids.map((id) => ({ id, zip: '94536', years_owned: id === 1 ? 12 : 3 })),
    ...overrides,
  };
}

const now = () => new Date('2026-11-21T09:00:00Z');

describe('get_overall_stats', () => {
  it('summarises outcomes and the hot lead rate', async () => {
    const tools = createCoachTools(fakeData(), now);
    const out = await tools.get_overall_stats!({});
    expect(out.data).toMatchObject({
      outcomes: { sell: 1, vm: 1, no: 1, skip: 1 },
      conversations_logged: 3,
      sessions_completed: 2,
    });
    expect((out.data as { hot_lead_rate: number }).hot_lead_rate).toBeCloseTo(1 / 3);
    expect(out.summary).toBe('3 calls logged: 1 hot, 1 voicemail, 1 not interested');
  });
});

describe('get_session_history', () => {
  it('returns sessions with the current streak', async () => {
    const tools = createCoachTools(fakeData(), now);
    const out = await tools.get_session_history!({ limit: 7 });
    expect((out.data as { current_streak_days: number }).current_streak_days).toBe(2);
    expect(out.summary).toContain('streak: 2 days');
  });

  it.each([
    [undefined, 14],
    [0, 14],
    [-5, 14],
    ['abc', 14],
    [999, 60],
    [7.9, 7],
  ])('clamps limit %s to %d before querying', async (input, expected) => {
    const data = fakeData();
    await createCoachTools(data, now).get_session_history!({ limit: input });
    expect(data.sessionLimits).toEqual([expected]);
  });

  it('tolerates a missing or non-object input', async () => {
    const data = fakeData();
    await createCoachTools(data, now).get_session_history!(undefined);
    expect(data.sessionLimits).toEqual([14]);
  });
});

describe('get_conversion_by_segment', () => {
  it('defaults to tenure and excludes skips', async () => {
    const out = await createCoachTools(fakeData(), now).get_conversion_by_segment!({});
    const data = out.data as { grouped_by: string; segments: { segment: string; calls: number }[] };
    expect(data.grouped_by).toBe('years owned');
    expect(data.segments.reduce((n, s) => n + s.calls, 0)).toBe(3);
  });

  it('groups by zip when asked', async () => {
    const out = await createCoachTools(fakeData(), now).get_conversion_by_segment!({ segment: 'zip' });
    expect((out.data as { grouped_by: string }).grouped_by).toBe('zip code');
  });

  it('reports calls whose homeowner no longer exists instead of failing or hiding them', async () => {
    const data = fakeData({
      calls: async () => [
        { homeowner_id: 1, outcome: 'sell' },
        { homeowner_id: 'o1', outcome: 'sell' },
        { homeowner_id: 'o2', outcome: 'no' },
      ],
      homeowners: async (ids) => ids.filter((id) => id === 1).map((id) => ({ id, zip: '94536', years_owned: 12 })),
    });
    const out = await createCoachTools(data, now).get_conversion_by_segment!({});
    expect((out.data as { unmatched_calls: number }).unmatched_calls).toBe(2);
    expect(out.summary).toBe('Compared 1 ownership-length groups across 1 calls (2 older calls had no matching homeowner)');
  });

  it('does not query homeowners when there are no calls', async () => {
    let looked = false;
    const data = fakeData({
      calls: async () => [],
      homeowners: async () => {
        looked = true;
        return [];
      },
    });
    const out = await createCoachTools(data, now).get_conversion_by_segment!({});
    expect(looked).toBe(false);
    expect((out.data as { segments: unknown[] }).segments).toEqual([]);
  });
});

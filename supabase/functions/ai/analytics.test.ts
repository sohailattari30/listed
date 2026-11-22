import { describe, expect, it } from 'vitest';
import { currentStreak, groupConversion, hotLeadRate, tallyOutcomes, tenureBucket } from './analytics.ts';

describe('tallyOutcomes', () => {
  it('counts each outcome and ignores unknown values, including prototype keys', () => {
    const tally = tallyOutcomes([
      { outcome: 'sell' },
      { outcome: 'vm' },
      { outcome: 'vm' },
      { outcome: 'no' },
      { outcome: 'skip' },
      { outcome: 'toString' },
      { outcome: 'garbage' },
    ]);
    expect(tally).toEqual({ sell: 1, vm: 2, no: 1, skip: 1 });
  });
});

describe('hotLeadRate', () => {
  it('is null when there are no real conversations', () => {
    expect(hotLeadRate({ sell: 0, vm: 0, no: 0, skip: 9 })).toBeNull();
  });
  it('excludes skips from the denominator', () => {
    expect(hotLeadRate({ sell: 2, vm: 3, no: 5, skip: 40 })).toBe(0.2);
  });
});

describe('currentStreak', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  it('counts consecutive days ending today', () => {
    expect(currentStreak(['2026-11-21', '2026-11-20', '2026-11-19', '2026-11-17'], now)).toBe(3);
  });
  it('keeps the streak alive when you have not called yet today', () => {
    expect(currentStreak(['2026-11-20', '2026-11-19'], now)).toBe(2);
  });
  it('is zero after a missed day', () => {
    expect(currentStreak(['2026-11-19'], now)).toBe(0);
  });
  it('is zero with no sessions', () => {
    expect(currentStreak([], now)).toBe(0);
  });
  it('ignores duplicate dates', () => {
    expect(currentStreak(['2026-11-21', '2026-11-21'], now)).toBe(1);
  });
});

describe('tenureBucket', () => {
  it.each([
    [0, '0-4 years'],
    [4, '0-4 years'],
    [5, '5-9 years'],
    [9, '5-9 years'],
    [10, '10-19 years'],
    [19, '10-19 years'],
    [20, '20+ years'],
    [55, '20+ years'],
  ])('%d years -> %s', (years, bucket) => {
    expect(tenureBucket(years)).toBe(bucket);
  });
  it('does not misfile bad data as long tenure', () => {
    expect(tenureBucket(Number.NaN)).toBe('unknown');
  });
});

describe('groupConversion', () => {
  const owners = new Map([
    [1, { zip: '94536', years_owned: 3 }],
    [2, { zip: '94536', years_owned: 12 }],
    [3, { zip: '94587', years_owned: 25 }],
  ]);
  const calls = [
    { homeowner_id: 1, outcome: 'no' },
    { homeowner_id: 2, outcome: 'sell' },
    { homeowner_id: 2, outcome: 'vm' },
    { homeowner_id: 3, outcome: 'sell' },
    { homeowner_id: 3, outcome: 'skip' },
    { homeowner_id: 99, outcome: 'sell' },
  ];

  it('groups by tenure, skipping skips and unknown homeowners', () => {
    const rows = groupConversion(calls, owners, 'tenure');
    expect(rows).toEqual([
      { segment: '10-19 years', calls: 2, hot: 1, hot_lead_rate: 0.5 },
      { segment: '0-4 years', calls: 1, hot: 0, hot_lead_rate: 0 },
      { segment: '20+ years', calls: 1, hot: 1, hot_lead_rate: 1 },
    ]);
  });

  it('groups by zip', () => {
    const rows = groupConversion(calls, owners, 'zip');
    expect(rows.map((r) => [r.segment, r.calls, r.hot])).toEqual([
      ['94536', 3, 1],
      ['94587', 1, 1],
    ]);
  });
});

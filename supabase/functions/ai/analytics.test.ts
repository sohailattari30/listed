import { describe, expect, it } from 'vitest';
import { buildLocalIndex, median, percentileRank, personalByZip } from './analytics.ts';

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('buildLocalIndex', () => {
  it('summarises each zip: size, share owning 10+ years, median tenure', () => {
    const index = buildLocalIndex([
      { zip: '94536', years_owned: 3 },
      { zip: '94536', years_owned: 10 },
      { zip: '94536', years_owned: 25 },
      { zip: '94536', years_owned: 12 },
      { zip: '94587', years_owned: 4 },
    ]);
    expect(index.get('94536')).toEqual({ zip: '94536', homeowners: 4, longTenureShare: 0.75, medianTenureYears: 11 });
    expect(index.get('94587')).toMatchObject({ homeowners: 1, longTenureShare: 0 });
  });

  it('ignores rows with a missing or invalid tenure', () => {
    const index = buildLocalIndex([
      { zip: '94536', years_owned: Number.NaN },
      { zip: '94536', years_owned: 15 },
    ]);
    expect(index.get('94536')?.homeowners).toBe(1);
  });
});

describe('personalByZip', () => {
  const owners = new Map<string | number, { zip: string }>([
    [1, { zip: '94536' }],
    [2, { zip: '94536' }],
    [3, { zip: '94587' }],
  ]);

  it('counts real conversations and hot leads per zip, skipping skips', () => {
    const { byZip, unmatched } = personalByZip(
      [
        { homeowner_id: 1, outcome: 'sell' },
        { homeowner_id: 2, outcome: 'no' },
        { homeowner_id: 2, outcome: 'vm' },
        { homeowner_id: 3, outcome: 'skip' },
      ],
      owners,
    );
    expect(byZip.get('94536')).toEqual({ zip: '94536', conversations: 3, hot: 1, hotRate: 1 / 3 });
    expect(byZip.has('94587')).toBe(false);
    expect(unmatched).toBe(0);
  });

  it('counts calls whose homeowner no longer exists instead of dropping them silently', () => {
    const { byZip, unmatched } = personalByZip(
      [
        { homeowner_id: 'o1', outcome: 'sell' },
        { homeowner_id: 'o2', outcome: 'no' },
        { homeowner_id: 1, outcome: 'no' },
      ],
      owners,
    );
    expect(unmatched).toBe(2);
    expect(byZip.get('94536')?.conversations).toBe(1);
  });
});

describe('percentileRank', () => {
  it('places a value within its group', () => {
    expect(percentileRank([1, 2, 3, 4], 4)).toBe(0.875);
    expect(percentileRank([1, 2, 3, 4], 1)).toBe(0.125);
  });
  it('splits ties and ignores nulls', () => {
    expect(percentileRank([5, 5, 5], 5)).toBe(0.5);
    expect(percentileRank([null, 1, 3], 3)).toBe(0.75);
  });
  it('is neutral with nothing to compare against', () => {
    expect(percentileRank([], 7)).toBe(0.5);
    expect(percentileRank([null], 7)).toBe(0.5);
  });
});

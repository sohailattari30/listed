import { describe, expect, it } from 'vitest';
import { buildHistory, progressPercent, recordCall, streetOf, summarizeHistory, truePeopleSearchUrl } from './dial';

describe('truePeopleSearchUrl', () => {
  it('builds a search from the street and the city/state/zip', () => {
    expect(truePeopleSearchUrl('123 Main St, Fremont, CA', '94536')).toBe(
      'https://www.truepeoplesearch.com/results?streetaddress=123%20Main%20St&citystatezip=Fremont%20CA%2094536',
    );
  });
  it('encodes special characters and tolerates short addresses', () => {
    expect(truePeopleSearchUrl('5 A&B Way', '')).toContain('streetaddress=5%20A%26B%20Way');
  });
});

describe('streetOf', () => {
  it('takes the part before the first comma', () => {
    expect(streetOf('12 Oak Ave, Union City, CA')).toBe('12 Oak Ave');
    expect(streetOf('12 Oak Ave')).toBe('12 Oak Ave');
  });
});

describe('call history', () => {
  it('counts calls and remembers the last real outcome (skips do not overwrite it)', () => {
    const history = buildHistory([
      { homeowner_id: 1, outcome: 'vm' },
      { homeowner_id: 1, outcome: 'skip' },
      { homeowner_id: 2, outcome: 'sell' },
    ]);
    expect(history.get(1)).toEqual({ count: 2, lastOutcome: 'vm' });
    expect(history.get(2)).toEqual({ count: 1, lastOutcome: 'sell' });
  });
  it('recordCall does not mutate the original map', () => {
    const before = buildHistory([]);
    recordCall(before, 1, 'no');
    expect(before.size).toBe(0);
  });
});

describe('summarizeHistory', () => {
  it('describes a first call', () => {
    expect(summarizeHistory(undefined)).toEqual({ tone: 'new', text: 'First time calling', badge: null });
  });
  it.each([
    ['sell', 'hot', 'Called 2x · Previously interested'],
    ['vm', 'called', 'Called 2x · Left voicemail'],
    ['no', 'called', 'Called 2x · Said not interested'],
  ] as const)('describes a last outcome of %s', (outcome, tone, text) => {
    const s = summarizeHistory({ count: 2, lastOutcome: outcome });
    expect(s).toMatchObject({ tone, text });
    expect(s.badge?.kind).toBe(outcome);
  });
  it('does not claim "not interested" when every earlier call was a skip', () => {
    expect(summarizeHistory({ count: 3, lastOutcome: null })).toEqual({ tone: 'called', text: 'Called 3x · Skipped before', badge: null });
  });
});

describe('progressPercent', () => {
  it('has a 2% floor so the bar is visible on call 1', () => {
    expect(progressPercent(1, 100)).toBe(2);
    expect(progressPercent(25, 50)).toBe(50);
    expect(progressPercent(50, 50)).toBe(100);
  });
  it('is safe for an empty queue', () => {
    expect(progressPercent(1, 0)).toBe(0);
  });
});

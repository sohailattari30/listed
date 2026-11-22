import { describe, expect, it } from 'vitest';
import { parseCoachText } from './coach';

describe('parseCoachText', () => {
  it('splits headline, insights and the Today line', () => {
    const parsed = parseCoachText('Solid week.\n- Hot rate is 4%.\n- Owners of 10+ years convert best.\nToday: call long-term owners first.');
    expect(parsed).toEqual({
      headline: 'Solid week.',
      insights: ['Hot rate is 4%.', 'Owners of 10+ years convert best.'],
      today: 'call long-term owners first.',
    });
  });
  it('is tolerant of a model that ignores the format', () => {
    expect(parseCoachText('Just keep calling.')).toEqual({ headline: 'Just keep calling.', insights: [], today: null });
    expect(parseCoachText('')).toEqual({ headline: null, insights: [], today: null });
  });
  it('keeps unformatted extra lines instead of dropping them', () => {
    expect(parseCoachText('Head\nA stray line').insights).toEqual(['A stray line']);
  });
});

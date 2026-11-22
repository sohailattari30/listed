import { describe, expect, it } from 'vitest';
import { avatarTone, initials, tagTone } from './contacts';

describe('initials', () => {
  it('uses the first two words', () => {
    expect(initials('john smith')).toBe('JS');
    expect(initials('Mary Jane Watson')).toBe('MJ');
  });
  it('handles one word and empty input', () => {
    expect(initials('Cher')).toBe('C');
    expect(initials('')).toBe('');
  });
});

describe('tones', () => {
  it('maps statuses to colours', () => {
    expect(avatarTone('Hot lead')).toBe('hot');
    expect(avatarTone('Callback')).toBe('vm');
    expect(avatarTone('Long-term')).toBe('def');
    expect(tagTone('Hot lead')).toBe('hot');
    expect(tagTone('Met in person')).toBe('vm');
  });
});

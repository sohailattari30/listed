import { describe, expect, it } from 'vitest';
import { isZip, parseTerritory, territoryLabel } from './territory';

describe('isZip', () => {
  it.each([
    ['94536', true],
    ['9453', false],
    ['945366', false],
    ['abcde', false],
    ['94536 ', false],
  ])('%j -> %s', (input, expected) => {
    expect(isZip(input)).toBe(expected);
  });
});

describe('parseTerritory', () => {
  it('treats five digits as a zip', () => {
    expect(parseTerritory(' 94536 ')).toEqual({ zip: '94536', city: '94536' });
  });
  it('treats anything else as a city', () => {
    expect(parseTerritory('Fremont, CA')).toEqual({ zip: '', city: 'Fremont, CA' });
  });
  it('rejects empty input', () => {
    expect(parseTerritory('   ')).toBeNull();
  });
});

describe('territoryLabel', () => {
  it('shows zip and city together', () => {
    expect(territoryLabel({ zip: '94536', city: 'Fremont, CA' })).toBe('94536 · Fremont, CA');
  });
  it('falls back to the city, then to "Not set"', () => {
    expect(territoryLabel({ zip: '', city: 'Fremont' })).toBe('Fremont');
    expect(territoryLabel({ zip: null, city: null })).toBe('Not set');
  });
});

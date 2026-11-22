import { describe, expect, it } from 'vitest';
import { MARKET_DATA, MARKET_SOURCES, RC_COLUMNS } from './market-data.ts';
import { loadMetrics, marketAsOf } from './market.ts';

// Guards the generated snapshot (npm run data:refresh) so a bad refresh cannot ship silently.
describe('market data snapshot', () => {
  it('covers the Bay Area and the markets the app launches with', () => {
    expect(MARKET_DATA.length).toBeGreaterThan(150);
    const zips = new Set(MARKET_DATA.map((z) => z.zip));
    for (const zip of ['94536', '94587', '94022']) expect(zips.has(zip)).toBe(true);
  });

  it('has well-formed rows: five-digit zips, no duplicates, oldest-first months, the right column count', () => {
    expect(new Set(MARKET_DATA.map((z) => z.zip)).size).toBe(MARKET_DATA.length);
    for (const z of MARKET_DATA) {
      expect(z.zip).toMatch(/^\d{5}$/);
      expect(z.rc.length).toBeGreaterThan(0);
      expect(z.rc.length).toBeLessThanOrEqual(15);
      for (const row of z.rc) expect(row).toHaveLength(RC_COLUMNS.length);
      const months = z.rc.map((r) => r[0]);
      expect(months).toEqual([...months].sort((a, b) => a - b));
      expect(z.zhvi.length).toBeLessThanOrEqual(15);
    }
  });

  it('is recent and labelled', () => {
    expect(MARKET_SOURCES.realtorAsOf).toBeGreaterThan(202600);
    expect(marketAsOf().realtor).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
    expect(marketAsOf().zillow).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
  });

  it('yields usable metrics for most zips, including year-over-year changes', () => {
    const metrics = loadMetrics();
    const share = (pick: (m: (typeof metrics)[number]) => unknown) => metrics.filter((m) => pick(m) !== null).length / metrics.length;
    expect(share((m) => m.pendingYoY)).toBeGreaterThan(0.8);
    expect(share((m) => m.valueYoY)).toBeGreaterThan(0.9);
    expect(share((m) => m.pendingRatio3m)).toBeGreaterThan(0.9);
    for (const m of metrics) if (m.valueYoY !== null) expect(Math.abs(m.valueYoY)).toBeLessThan(1);
  });
});

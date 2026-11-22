import { describe, expect, it } from 'vitest';
import { buildForecast, CALLS_PER_DAY, DAYS_FROM_LEADS_TO_LISTING, INDUSTRY_RATE, LEADS_NEEDED, smoothedRate } from './forecast';

const now = new Date(2026, 10, 21);

describe('smoothedRate', () => {
  it('is the industry rate with no data', () => {
    expect(smoothedRate(0, 0)).toBeCloseTo(INDUSTRY_RATE);
  });
  it('moves toward the observed rate as calls accumulate', () => {
    const small = smoothedRate(5, 20); // observed 25%
    const large = smoothedRate(250, 1000); // observed 25%
    expect(small).toBeLessThan(large);
    expect(large).toBeGreaterThan(0.2);
    expect(small).toBeGreaterThan(INDUSTRY_RATE);
  });
  it('never reaches zero, even after many cold calls', () => {
    expect(smoothedRate(0, 500)).toBeGreaterThan(0);
  });
});

describe('buildForecast', () => {
  it('matches the industry-average forecast for a brand new user', () => {
    const f = buildForecast(0, 0, now);
    expect(f.leadsStillNeeded).toBe(LEADS_NEEDED);
    // 10 leads at 1.5/day = 7 days, plus the 14-day runway to a listing
    expect(f.totalDays).toBe(7 + DAYS_FROM_LEADS_TO_LISTING);
    expect(f.hotPerDay).toBeCloseTo(CALLS_PER_DAY * INDUSTRY_RATE);
    expect(f.personalized).toBe(false);
  });

  it('does not explode to a year after a cold streak (the old code jumped to 334 days)', () => {
    const f = buildForecast(25, 0, now);
    expect(f.totalDays).toBeLessThan(60);
    expect(f.personalized).toBe(true);
  });

  it('shortens the forecast as hot leads arrive', () => {
    expect(buildForecast(100, 6, now).totalDays).toBeLessThan(buildForecast(100, 1, now).totalDays);
  });

  it('only counts the runway once enough leads are in', () => {
    const f = buildForecast(100, 12, now);
    expect(f.leadsStillNeeded).toBe(0);
    expect(f.totalDays).toBe(DAYS_FROM_LEADS_TO_LISTING);
  });

  it('puts the date totalDays after now', () => {
    const f = buildForecast(0, 0, now);
    expect(Math.round((f.date.getTime() - now.getTime()) / 86_400_000)).toBe(f.totalDays);
  });
});

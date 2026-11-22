export const LEADS_NEEDED = 10;
export const CALLS_PER_DAY = 50;
export const INDUSTRY_RATE = 0.03;
/** The industry average counts as this many imaginary calls, so a tiny sample can't swing the forecast. */
export const PRIOR_STRENGTH = 100;
export const DAYS_FROM_LEADS_TO_LISTING = 14;
export const PERSONAL_RATE_MIN_CALLS = 20;

/** Beta-binomial posterior mean: observed results blended with the industry prior. */
export function smoothedRate(hotLeads: number, totalCalls: number): number {
  return (hotLeads + INDUSTRY_RATE * PRIOR_STRENGTH) / (totalCalls + PRIOR_STRENGTH);
}

export interface Forecast {
  leadsStillNeeded: number;
  conversionRate: number;
  hotPerDay: number;
  totalDays: number;
  date: Date;
  personalized: boolean;
}

export function buildForecast(totalCalls: number, hotLeads: number, now: Date = new Date()): Forecast {
  const conversionRate = smoothedRate(hotLeads, totalCalls);
  const leadsStillNeeded = Math.max(0, LEADS_NEEDED - hotLeads);
  const hotPerDay = CALLS_PER_DAY * conversionRate;
  const totalDays = Math.ceil(leadsStillNeeded / hotPerDay) + DAYS_FROM_LEADS_TO_LISTING;
  const date = new Date(now);
  date.setDate(date.getDate() + totalDays);
  return {
    leadsStillNeeded,
    conversionRate,
    hotPerDay,
    totalDays,
    date,
    personalized: totalCalls > PERSONAL_RATE_MIN_CALLS,
  };
}

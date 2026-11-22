import type { Outcome } from './database.types';

export interface CallHistory {
  count: number;
  lastOutcome: Exclude<Outcome, 'skip'> | null;
}

export const streetOf = (address: string): string => address.split(',')[0]?.trim() ?? '';

export function truePeopleSearchUrl(address: string, zip: string): string {
  const parts = address.split(',');
  const street = (parts[0] ?? '').trim();
  const cityState = [parts[1], parts[2]]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return (
    'https://www.truepeoplesearch.com/results?streetaddress=' +
    encodeURIComponent(street) +
    '&citystatezip=' +
    encodeURIComponent(`${cityState} ${zip}`)
  );
}

export function recordCall(history: ReadonlyMap<string | number, CallHistory>, homeownerId: string | number, outcome: Outcome): Map<string | number, CallHistory> {
  const next = new Map(history);
  const prev = next.get(homeownerId) ?? { count: 0, lastOutcome: null };
  next.set(homeownerId, { count: prev.count + 1, lastOutcome: outcome === 'skip' ? prev.lastOutcome : outcome });
  return next;
}

export function buildHistory(calls: ReadonlyArray<{ homeowner_id: string | number; outcome: Outcome }>): Map<string | number, CallHistory> {
  let history = new Map<string | number, CallHistory>();
  for (const call of calls) history = recordCall(history, call.homeowner_id, call.outcome);
  return history;
}

export interface HistorySummary {
  tone: 'new' | 'called' | 'hot';
  text: string;
  badge: { kind: 'sell' | 'vm' | 'no'; text: string } | null;
}

export function summarizeHistory(history: CallHistory | undefined): HistorySummary {
  if (!history || history.count === 0) return { tone: 'new', text: 'First time calling', badge: null };
  const prefix = `Called ${history.count}x`;
  switch (history.lastOutcome) {
    case 'sell':
      return { tone: 'hot', text: `${prefix} · Previously interested`, badge: { kind: 'sell', text: 'Previously interested in selling' } };
    case 'vm':
      return { tone: 'called', text: `${prefix} · Left voicemail`, badge: { kind: 'vm', text: 'Voicemail last time' } };
    case 'no':
      return { tone: 'called', text: `${prefix} · Said not interested`, badge: { kind: 'no', text: 'Said not interested before' } };
    default:
      return { tone: 'called', text: `${prefix} · Skipped before`, badge: null };
  }
}

export const progressPercent = (position: number, total: number): number => (total <= 0 ? 0 : Math.max(2, Math.round((position / total) * 100)));

import { z } from 'zod';
import { CoachSchema, type CoachResult } from './ai';

const CACHE_KEY = 'listed_coach';
const COLLAPSED_KEY = 'listed_coach_collapsed';

const CacheSchema = z.object({
  date: z.string(),
  at: z.string(),
  callCount: z.number().nullable(),
  result: CoachSchema,
});
export type CoachCache = z.infer<typeof CacheSchema>;

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** Today's saved coach answer, if there is one. One slot, so old days never pile up. */
export function readCoachCache(storage: Reader, now: Date = new Date()): CoachCache | null {
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = CacheSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.date === now.toDateString() ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeCoachCache(storage: Writer, result: CoachResult, callCount: number | null, now: Date = new Date()): CoachCache {
  const cache: CoachCache = { date: now.toDateString(), at: now.toISOString(), callCount, result };
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable: the card still works, it just asks again next visit
  }
  return cache;
}

/** True when more calls have been logged since the coach last ran. */
export function hasNewCalls(cache: Pick<CoachCache, 'callCount'>, callCount: number | undefined): boolean {
  return callCount !== undefined && cache.callCount !== null && cache.callCount !== callCount;
}

export const readCollapsed = (storage: Reader): boolean => {
  try {
    return storage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

export function writeCollapsed(storage: Writer, collapsed: boolean): void {
  try {
    storage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore
  }
}

import { AdvisorSchema, type AdvisorResult } from './markets';
import { z } from 'zod';

const KEY = 'listed_advisor';
const CacheSchema = z.object({ date: z.string(), at: z.string(), result: AdvisorSchema });
export type AdvisorCache = z.infer<typeof CacheSchema>;

/** Today's saved analysis, if there is one. A single slot, so old days never pile up. */
export function readAdvisorCache(storage: Pick<Storage, 'getItem'>, now: Date = new Date()): AdvisorCache | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = CacheSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.date === now.toDateString() ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeAdvisorCache(storage: Pick<Storage, 'setItem'>, result: AdvisorResult, now: Date = new Date()): AdvisorCache {
  const cache: AdvisorCache = { date: now.toDateString(), at: now.toISOString(), result };
  try {
    storage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable: it still works, it just asks again next visit
  }
  return cache;
}

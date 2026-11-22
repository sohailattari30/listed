import type { HomeownerRow, Id } from './database.types';

export const QUEUE_SIZE = 50;
export const SESSION_STORAGE_KEY = 'listed_session';

/** Deterministic shuffle: the same seed always gives the same order. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Changes once a day per territory, so today's 50 numbers stay the same all day. */
export function dailySeed(zip: string, now: Date = new Date()): number {
  const text = `${now.getFullYear()}${now.getMonth()}${now.getDate()}${zip}`;
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface DialQueue {
  owners: HomeownerRow[];
  cur: number;
  sells: number;
  vms: number;
  nos: number;
  hotLeads: HomeownerRow[];
}

export interface SessionSnapshot {
  cur: number;
  sells: number;
  vms: number;
  nos: number;
  hotLeads: HomeownerRow[];
  ownerIds: Id[];
  date: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function freshQueue(homeowners: readonly HomeownerRow[], zip: string, now: Date = new Date()): DialQueue {
  return {
    owners: seededShuffle(homeowners, dailySeed(zip, now)).slice(0, QUEUE_SIZE),
    cur: 0,
    sells: 0,
    vms: 0,
    nos: 0,
    hotLeads: [],
  };
}

/** Resume today's saved position if its homeowners still exist, otherwise start fresh. */
export function buildQueue(
  homeowners: readonly HomeownerRow[],
  saved: SessionSnapshot | null,
  zip: string,
  now: Date = new Date(),
): DialQueue {
  if (saved?.ownerIds) {
    const byId = new Map(homeowners.map((h) => [h.id, h]));
    const owners = saved.ownerIds.map((id) => byId.get(id)).filter((h): h is HomeownerRow => h !== undefined);
    if (owners.length >= Math.min(QUEUE_SIZE, homeowners.length) && owners.length > 0) {
      return {
        owners,
        cur: saved.cur || 0,
        sells: saved.sells || 0,
        vms: saved.vms || 0,
        nos: saved.nos || 0,
        hotLeads: saved.hotLeads || [],
      };
    }
  }
  return freshQueue(homeowners, zip, now);
}

export function loadSnapshot(storage: StorageLike, now: Date = new Date()): SessionSnapshot | null {
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as SessionSnapshot;
    if (snapshot.date !== now.toDateString()) {
      storage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(storage: StorageLike, queue: DialQueue, now: Date = new Date()): void {
  const snapshot: SessionSnapshot = {
    cur: queue.cur,
    sells: queue.sells,
    vms: queue.vms,
    nos: queue.nos,
    hotLeads: queue.hotLeads,
    ownerIds: queue.owners.map((o) => o.id),
    date: now.toDateString(),
  };
  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode or full storage: the session just won't survive a refresh.
  }
}

export function clearSnapshot(storage: StorageLike): void {
  try {
    storage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

import { describe, expect, it } from 'vitest';
import {
  buildQueue,
  clearSnapshot,
  dailySeed,
  freshQueue,
  loadSnapshot,
  QUEUE_SIZE,
  saveSnapshot,
  seededShuffle,
  SESSION_STORAGE_KEY,
} from './queue';
import type { HomeownerRow } from './database.types';

const owners = (n: number): HomeownerRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, address: `${i} Main St, Fremont, CA`, owner_name: `Owner ${i}`, years_owned: i % 30, zip: '94536' }));

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('seededShuffle', () => {
  it('is deterministic for a seed and a permutation of the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = seededShuffle(input, 42);
    expect(seededShuffle(input, 42)).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(input);
  });
  it('does not mutate its input', () => {
    const input = [1, 2, 3, 4, 5];
    seededShuffle(input, 7);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
  it('gives different orders for different seeds', () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    expect(seededShuffle(input, 1)).not.toEqual(seededShuffle(input, 2));
  });
  it('handles empty and single-item lists', () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle(['x'], 1)).toEqual(['x']);
  });
});

describe('dailySeed', () => {
  const day = new Date(2026, 10, 21, 8, 0);
  it('is stable within a day and a non-negative integer', () => {
    expect(dailySeed('94536', day)).toBe(dailySeed('94536', new Date(2026, 10, 21, 23, 59)));
    expect(Number.isInteger(dailySeed('94536', day))).toBe(true);
    expect(dailySeed('94536', day)).toBeGreaterThanOrEqual(0);
  });
  it('changes with the day and the zip', () => {
    expect(dailySeed('94536', day)).not.toBe(dailySeed('94536', new Date(2026, 10, 22)));
    expect(dailySeed('94536', day)).not.toBe(dailySeed('94587', day));
  });
});

describe('freshQueue', () => {
  it('takes at most QUEUE_SIZE homeowners and starts at zero', () => {
    const q = freshQueue(owners(300), '94536');
    expect(q.owners).toHaveLength(QUEUE_SIZE);
    expect(q).toMatchObject({ cur: 0, sells: 0, vms: 0, nos: 0, hotLeads: [] });
  });
  it('uses everyone when the market is small', () => {
    expect(freshQueue(owners(12), '94536').owners).toHaveLength(12);
  });
  it('is the same all day for the same territory', () => {
    const all = owners(300);
    const a = freshQueue(all, '94536', new Date(2026, 10, 21, 7));
    const b = freshQueue(all, '94536', new Date(2026, 10, 21, 21));
    expect(a.owners.map((o) => o.id)).toEqual(b.owners.map((o) => o.id));
  });
});

describe('snapshots', () => {
  const now = new Date(2026, 10, 21, 10);

  it('round-trips a queue within the same day', () => {
    const storage = new MemoryStorage();
    const queue = { ...freshQueue(owners(300), '94536', now), cur: 7, sells: 2, vms: 3, nos: 2 };
    saveSnapshot(storage, queue, now);
    const snapshot = loadSnapshot(storage, now);
    expect(snapshot).toMatchObject({ cur: 7, sells: 2, vms: 3, nos: 2 });
    expect(snapshot?.ownerIds).toEqual(queue.owners.map((o) => o.id));
  });

  it('discards yesterday\'s snapshot', () => {
    const storage = new MemoryStorage();
    saveSnapshot(storage, freshQueue(owners(300), '94536', now), now);
    expect(loadSnapshot(storage, new Date(2026, 10, 22))).toBeNull();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('survives corrupt data and a missing key', () => {
    const storage = new MemoryStorage();
    expect(loadSnapshot(storage, now)).toBeNull();
    storage.setItem(SESSION_STORAGE_KEY, '{not json');
    expect(loadSnapshot(storage, now)).toBeNull();
  });

  it('clearSnapshot removes the key', () => {
    const storage = new MemoryStorage();
    saveSnapshot(storage, freshQueue(owners(60), '94536', now), now);
    clearSnapshot(storage);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe('buildQueue', () => {
  const now = new Date(2026, 10, 21, 10);
  const all = owners(300);

  it('resumes saved progress when the homeowners still exist', () => {
    const base = freshQueue(all, '94536', now);
    const storage = new MemoryStorage();
    saveSnapshot(storage, { ...base, cur: 12, sells: 1, hotLeads: [base.owners[0]!] }, now);
    const resumed = buildQueue(all, loadSnapshot(storage, now), '94536', now);
    expect(resumed.cur).toBe(12);
    expect(resumed.sells).toBe(1);
    expect(resumed.owners.map((o) => o.id)).toEqual(base.owners.map((o) => o.id));
  });

  it('starts fresh when saved ids no longer exist', () => {
    const base = freshQueue(all, '94536', now);
    const storage = new MemoryStorage();
    saveSnapshot(storage, { ...base, cur: 12 }, now);
    const resumed = buildQueue(owners(10), loadSnapshot(storage, now), '94536', now);
    expect(resumed.cur).toBe(0);
    expect(resumed.owners).toHaveLength(10);
  });

  it('starts fresh with no snapshot', () => {
    expect(buildQueue(all, null, '94536', now).cur).toBe(0);
  });
});
